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


def _session_yaml(copy_out, paste_in):
    # Per-session KasmVNC config: network (plain HTTP, no SSL — access is
    # grant-checked at the tunnel entry) + clipboard DLP.
    #
    # allow_client_to_override_kasm_server_settings MUST be false: KasmVNC's shipped
    # defaults list the clipboard-direction DLP keys in allow_override_list, and it
    # MERGES that list rather than replacing it, so leaving override enabled lets the
    # web client re-enable a blocked direction (the vendor's browser must not be able
    # to override a security policy). With override off, the server-side DLP below is
    # authoritative; the client's own seamless clipboard still works for whichever
    # direction the server allows.
    return (
        "network:\n"
        "  protocol: http\n"
        "  ssl:\n"
        "    require_ssl: false\n"
        "  udp:\n"
        "    public_ip: 127.0.0.1\n"
        "runtime_configuration:\n"
        "  allow_client_to_override_kasm_server_settings: false\n"
        "  allow_override_standard_vnc_server_settings: false\n"
        "data_loss_prevention:\n"
        "  clipboard:\n"
        "    server_to_client:\n"
        "      enabled: " + ("true" if copy_out else "false") + "\n"
        "      primary_clipboard_enabled: false\n"
        "    client_to_server:\n"
        "      enabled: " + ("true" if paste_in else "false") + "\n")


def _spawn(display, url, profile, home, copy_out, paste_in):
    disp = ":%d" % display
    env = {**os.environ, "DISPLAY": disp, "HOME": home}
    os.makedirs(profile, exist_ok=True)
    os.makedirs(home + "/.vnc", exist_ok=True)
    with open(home + "/.vnc/kasmvnc.yaml", "w") as f:
        f.write(_session_yaml(copy_out, paste_in))
    # A SIGKILLed predecessor on this (reused) display can leave a stale X lock +
    # socket, so the new Xvnc refuses to start and then serves a dead/blank display
    # — an intermittent blank-session hang. Clear both before starting.
    for stale in ("/tmp/.X%d-lock" % display, "/tmp/.X11-unix/X%d" % display):
        try:
            os.remove(stale)
        except OSError:
            pass
    port = BASE_PORT + display
    xvnc = subprocess.Popen(
        ["Xvnc", disp, "-geometry", "1280x800", "-depth", "24",
         "-websocketPort", str(port), "-interface", "0.0.0.0",
         "-httpd", "/usr/share/kasmvnc/www", "-SecurityTypes", "None",
         "-disableBasicAuth"], env=env)
    time.sleep(1.5)
    fbox = subprocess.Popen(["fluxbox"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    shutil.rmtree(sess["profile"], ignore_errors=True)
    shutil.rmtree(sess["home"], ignore_errors=True)


def open_session(url, copy_out, paste_in):
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
        procs = _spawn(display, url, profile, home, copy_out, paste_in)
        port = BASE_PORT + display
        _sessions[sid] = {"display": display, "port": port, "procs": procs,
                          "profile": profile, "home": home, "started": time.time()}
        return {"id": sid, "port": port}


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
            copy_out = data.get("copyOut", True)
            paste_in = data.get("pasteIn", True)
            res = open_session(url, copy_out, paste_in)
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
