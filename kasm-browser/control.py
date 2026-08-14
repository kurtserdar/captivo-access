#!/usr/bin/env python3
# In-container session broker for the high-fidelity (KasmVNC) isolated browser.
# Spawns a fresh per-session Xvnc (display + RFB + web/WS on one port) + fluxbox +
# kiosk Chromium on demand and reaps it on close. No docker socket: sessions are
# PROCESSES inside this one container. The hub (Xvnc :1 on 6901, started by
# entrypoint.sh) serves the static web client; per-session ports serve live RFB.
import json, os, shutil, signal, subprocess, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHROME = shutil.which("chromium") or shutil.which("chromium-browser") or "chromium"
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "5"))
MAX_SESSION_SECONDS = int(os.environ.get("MAX_SESSION_SECONDS", "14400"))
BASE_PORT = 6900  # per-session port = BASE_PORT + display; hub is 6901 (display :1)

_lock = threading.Lock()
_sessions = {}  # id -> {"display": N, "port": p, "procs": [...], "profile": path, "started": ts}
_seq = {"n": 0}


def _free_display():
    # Display 1 is the hub; sessions use 2..MAX_SESSIONS+1.
    used = {s["display"] for s in _sessions.values()}
    for n in range(2, MAX_SESSIONS + 2):
        if n not in used:
            return n
    return None


def _clamp_dim(v, lo, hi, default):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _spawn(display, url, profile, home, copy_out, paste_in, w=1280, h=800):
    disp = ":%d" % display
    env = {**os.environ, "DISPLAY": disp, "HOME": home}
    os.makedirs(profile, exist_ok=True)
    os.makedirs(home + "/.vnc", exist_ok=True)
    # A SIGKILLed predecessor on this (reused) display can leave a stale X lock +
    # socket, so the new Xvnc refuses to start and then serves a dead/blank display
    # — an intermittent blank-session hang. Clear both before starting.
    for stale in ("/tmp/.X%d-lock" % display, "/tmp/.X11-unix/X%d" % display):
        try:
            os.remove(stale)
        except OSError:
            pass
    port = BASE_PORT + display
    # Clipboard DLP is applied as Xvnc parameters, NOT via kasmvnc.yaml: KasmVNC's
    # data_loss_prevention YAML is only read by the kasmvncserver wrapper, which
    # translates server_to_client.enabled -> SendCutText and client_to_server.enabled
    # -> AcceptCutText. We launch Xvnc directly (bypassing the wrapper), so a YAML
    # config is ignored entirely — the flags below are the real, enforced control.
    #   SendCutText   = server -> client = copy-out (isolated desktop -> vendor)
    #   AcceptCutText = client -> server = paste-in (vendor -> isolated desktop)
    send_cut = "-SendCutText=" + ("1" if copy_out else "0")
    accept_cut = "-AcceptCutText=" + ("1" if paste_in else "0")
    xvnc = subprocess.Popen(
        ["Xvnc", disp, "-geometry", "%dx%d" % (w, h), "-depth", "24",
         "-websocketPort", str(port), "-interface", "0.0.0.0",
         "-httpd", "/usr/share/kasmvnc/www", "-SecurityTypes", "None",
         "-disableBasicAuth", "-AlwaysShared=1", send_cut, accept_cut], env=env)
    time.sleep(1.5)
    fbox = subprocess.Popen(["fluxbox"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Paint a plain solid background so fluxbox's fbsetbg helper finds a wallpaper
    # setter and stops raising its "I can't find an app to set the wallpaper with"
    # X dialog (briefly visible in the canvas before Chromium kiosk covers it). No
    # brand image here — the app-side ConnectSplash carries the branding.
    subprocess.Popen(["hsetroot", "-solid", "#000000"], env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    chrome = subprocess.Popen(
        [CHROME, "--kiosk", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
         "--no-first-run", "--no-default-browser-check", "--disable-translate",
         "--user-data-dir=" + profile, url], env=env)
    return [xvnc, fbox, chrome]


def _kill(sess):
    for p in sess["procs"]:
        if p.poll() is None:
            p.send_signal(signal.SIGTERM)
    time.sleep(1.0)
    for p in sess["procs"]:
        if p.poll() is None:
            p.kill()
    rec_proc = sess.get("rec_proc")
    if rec_proc is not None and rec_proc.poll() is None:
        rec_proc.kill()
    shutil.rmtree(sess["profile"], ignore_errors=True)
    shutil.rmtree(sess["home"], ignore_errors=True)
    rec_file = sess.get("rec_file")
    if rec_file:
        try:
            os.remove(rec_file)
        except OSError:
            pass


def open_session(url, copy_out, paste_in, w=1280, h=800):
    with _lock:
        if len(_sessions) >= MAX_SESSIONS:
            return None
        display = _free_display()
        if display is None:
            return None
        _seq["n"] += 1
        sid = "s%d-%d" % (int(time.time()), _seq["n"])
        profile = "/profiles/" + sid
        home = "/sess/" + sid
        procs = _spawn(display, url, profile, home, copy_out, paste_in, w, h)
        port = BASE_PORT + display
        _sessions[sid] = {"display": display, "port": port, "procs": procs,
                          "profile": profile, "home": home, "started": time.time(),
                          "w": w, "h": h}
        return {"id": sid, "port": port}


def close_session(sid):
    with _lock:
        sess = _sessions.pop(sid, None)
    if sess:
        _kill(sess)


def _ffmpeg_capture(display, recfile, w=1280, h=800):
    # Grab the per-session Xvnc display as WebM (VP8). The tee muxer writes two sinks:
    # the live pipe (stdout, streamed to the data-plane — crash-safe interim recording)
    # and a seekable file (finalized on clean stop for correct duration + seeking).
    # onfail=ignore keeps the file writing even if the pipe reader goes away. x11grab
    # is real-time paced, so an interrupted (SIGINT) capture still has correct
    # timestamps + duration.
    return subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-f", "x11grab",
         "-video_size", "%dx%d" % (w, h), "-framerate", "10", "-i", ":%d" % display,
         "-an", "-c:v", "libvpx", "-b:v", "1M", "-deadline", "realtime",
         "-f", "tee", "-map", "0:v",
         "[f=webm:onfail=ignore]pipe:1|[f=webm]" + recfile],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)


def _reaper():
    while True:
        time.sleep(60)
        now = time.time()
        with _lock:
            stale = [sid for sid, s in _sessions.items() if now - s["started"] > MAX_SESSION_SECONDS]
            for sid in stale:
                sess = _sessions.pop(sid)
                print("kasm-broker: reaping stale session " + sid, flush=True)
                threading.Thread(target=_kill, args=(sess,), daemon=True).start()


class H(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        # Live session recording: stream the ffmpeg WebM capture of the session's
        # display until the data-plane disconnects (recording lifecycle = connection
        # lifecycle). The broker never sees the recordingKey — the data-plane owns it.
        if u.path.startswith("/session/") and u.path.endswith("/rec"):
            sid = u.path[len("/session/"):-len("/rec")]
            with _lock:
                sess = _sessions.get(sid)
                display = sess["display"] if sess else None
                rec_w = sess.get("w", 1280) if sess else 1280
                rec_h = sess.get("h", 800) if sess else 800
            if display is None:
                return self._json(404, {"error": "not_found"})
            recfile = "/rec/" + sid + ".webm"
            proc = _ffmpeg_capture(display, recfile, rec_w, rec_h)
            with _lock:
                s = _sessions.get(sid)
                if s is not None:
                    s["rec_proc"] = proc
                    s["rec_file"] = recfile
            self.send_response(200)
            self.send_header("Content-Type", "video/webm")
            self.end_headers()
            try:
                while True:
                    # read1: forward whatever ffmpeg has produced so far instead of
                    # blocking for a full 64 KiB (a static page trickles bytes slowly).
                    buf = proc.stdout.read1(65536)
                    if not buf:
                        break
                    self.wfile.write(buf)  # raises when the data-plane disconnects
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                # SIGINT (not terminate/kill) so ffmpeg writes the trailer + Cues +
                # Duration, leaving /rec/<sid>.webm seekable for the finalize pull.
                if proc.poll() is None:
                    proc.send_signal(signal.SIGINT)
                    try:
                        proc.wait(timeout=8)
                    except Exception:
                        proc.kill()
            return
        # Finalized recording: stream the seekable /rec/<sid>.webm (finalizing first if
        # ffmpeg somehow still runs). The data-plane pulls this on clean session end.
        if u.path.startswith("/session/") and u.path.endswith("/recording"):
            sid = u.path[len("/session/"):-len("/recording")]
            with _lock:
                s = _sessions.get(sid)
                recfile = s.get("rec_file") if s else None
                proc = s.get("rec_proc") if s else None
            if proc is not None and proc.poll() is None:
                proc.send_signal(signal.SIGINT)
                try:
                    proc.wait(timeout=8)
                except Exception:
                    proc.kill()
            if not recfile or not os.path.exists(recfile):
                return self._json(404, {"error": "not_found"})
            try:
                self.send_response(200)
                self.send_header("Content-Type", "video/webm")
                self.send_header("Content-Length", str(os.path.getsize(recfile)))
                self.end_headers()
                with open(recfile, "rb") as f:
                    while True:
                        buf = f.read(65536)
                        if not buf:
                            break
                        self.wfile.write(buf)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return
        if u.path == "/healthz":
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/session":
            n = int(self.headers.get("Content-Length", "0") or "0")
            try:
                data = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                data = {}
            url = data.get("url", "")
            if not (isinstance(url, str) and (url.startswith("http://") or url.startswith("https://"))):
                return self._json(400, {"error": "bad_url"})
            copy_out = data.get("copyOut", True)
            paste_in = data.get("pasteIn", True)
            w = _clamp_dim(data.get("w"), 1024, 2560, 1280)
            h = _clamp_dim(data.get("h"), 640, 1600, 800)
            res = open_session(url, copy_out, paste_in, w, h)
            if res is None:
                return self._json(503, {"error": "capacity"})
            return self._json(201, res)
        if path.startswith("/session/") and path.endswith("/close"):
            sid = path[len("/session/"):-len("/close")]
            close_session(sid)
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not_found"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs("/profiles", exist_ok=True)
    os.makedirs("/rec", exist_ok=True)
    threading.Thread(target=_reaper, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 7900), H).serve_forever()
