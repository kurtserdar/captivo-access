#!/usr/bin/env python3
# In-container session broker for isolated browsers. Spawns a fresh per-session
# process group (Xvfb + fluxbox + x11vnc + kiosk Chromium) on demand and reaps it
# on close. No docker socket: sessions are PROCESSES inside this one container.
import json, os, shutil, signal, subprocess, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHROME = shutil.which("chromium") or shutil.which("chromium-browser") or "chromium"
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "5"))
MAX_SESSION_SECONDS = int(os.environ.get("MAX_SESSION_SECONDS", "14400"))
BASE_VNC_PORT = 5900

_lock = threading.Lock()
_sessions = {}  # id -> {"display": N, "port": p, "procs": [Popen...], "profile": path, "started": ts}
_seq = {"n": 0}


def _free_display():
    used = {s["display"] for s in _sessions.values()}
    for n in range(1, MAX_SESSIONS + 1):
        if n not in used:
            return n
    return None


def _spawn(display, url, profile):
    disp = ":%d" % display
    env = {**os.environ, "DISPLAY": disp}
    os.makedirs(profile, exist_ok=True)
    # A SIGKILLed predecessor on this (reused) display can leave a stale X lock +
    # socket, so the new Xvfb refuses to start ("server already active") and x11vnc
    # then serves a dead/blank display — an intermittent blank-session hang. Clear
    # both before starting so every reused display slot is clean.
    for stale in ("/tmp/.X%d-lock" % display, "/tmp/.X11-unix/X%d" % display):
        try:
            os.remove(stale)
        except OSError:
            pass
    xvfb = subprocess.Popen(["Xvfb", disp, "-screen", "0", "1280x800x24", "-nolisten", "tcp"])
    time.sleep(1.0)
    fbox = subprocess.Popen(["fluxbox"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    vnc = subprocess.Popen(["x11vnc", "-display", disp, "-forever", "-nopw",
                            "-rfbport", str(BASE_VNC_PORT + display), "-quiet"])
    chrome = subprocess.Popen(
        [CHROME, "--kiosk", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
         "--no-first-run", "--no-default-browser-check", "--disable-translate",
         "--user-data-dir=" + profile, url], env=env)
    return [xvfb, fbox, vnc, chrome]


def _kill(sess):
    for p in sess["procs"]:
        if p.poll() is None:
            p.send_signal(signal.SIGTERM)
    time.sleep(1.0)
    for p in sess["procs"]:
        if p.poll() is None:
            p.kill()
    shutil.rmtree(sess["profile"], ignore_errors=True)


def open_session(url):
    with _lock:
        if len(_sessions) >= MAX_SESSIONS:
            return None
        display = _free_display()
        if display is None:
            return None
        _seq["n"] += 1
        sid = "s%d-%d" % (int(time.time()), _seq["n"])
        profile = "/profiles/" + sid
        procs = _spawn(display, url, profile)
        _sessions[sid] = {"display": display, "port": BASE_VNC_PORT + display,
                          "procs": procs, "profile": profile, "started": time.time()}
        return {"id": sid, "vncPort": BASE_VNC_PORT + display}


def close_session(sid):
    with _lock:
        sess = _sessions.pop(sid, None)
    if sess:
        _kill(sess)


def _reaper():
    while True:
        time.sleep(60)
        now = time.time()
        with _lock:
            stale = [sid for sid, s in _sessions.items() if now - s["started"] > MAX_SESSION_SECONDS]
            for sid in stale:
                sess = _sessions.pop(sid)
                print("broker: reaping stale session " + sid, flush=True)
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
        if urllib.parse.urlparse(self.path).path == "/healthz":
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
            res = open_session(url)
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
    threading.Thread(target=_reaper, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 7900), H).serve_forever()
