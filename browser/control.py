#!/usr/bin/env python3
# Minimal in-container control for the isolated browser. Launches/relaunches a
# kiosk Chromium on DISPLAY :1. Internal-only (bind on the container network).
import os, shutil, signal, subprocess, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

PROFILE = "/profile"
CHROME = shutil.which("chromium") or shutil.which("chromium-browser") or "chromium"
_proc = {"p": None}


def launch(url):
    kill()
    os.makedirs(PROFILE, exist_ok=True)
    _proc["p"] = subprocess.Popen(
        [CHROME, "--kiosk", "--no-first-run", "--no-default-browser-check",
         "--disable-translate", "--no-sandbox", "--disable-gpu",
         "--disable-dev-shm-usage", "--user-data-dir=" + PROFILE, url],
        env={**os.environ, "DISPLAY": ":1"})


def kill():
    p = _proc["p"]
    if p and p.poll() is None:
        p.send_signal(signal.SIGTERM)
        try:
            p.wait(timeout=5)
        except Exception:
            p.kill()
    _proc["p"] = None


class H(BaseHTTPRequestHandler):
    def _send(self, code, msg=b"ok"):
        self.send_response(code)
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/navigate":
            q = urllib.parse.parse_qs(u.query).get("url", [""])[0]
            if not (q.startswith("http://") or q.startswith("https://")):
                return self._send(400, b"bad url")
            launch(q)
            return self._send(200)
        if u.path == "/healthz":
            return self._send(200)
        self._send(404, b"no")

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path == "/reset":
            kill()
            shutil.rmtree(PROFILE, ignore_errors=True)
            launch("about:blank")
            return self._send(200)
        self._send(404, b"no")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    launch("about:blank")
    HTTPServer(("0.0.0.0", 7900), H).serve_forever()
