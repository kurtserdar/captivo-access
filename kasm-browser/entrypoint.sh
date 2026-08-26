#!/bin/sh
set -e
mkdir -p /root/.vnc
cp /kasmvnc.yaml /root/.vnc/kasmvnc.yaml
# Clear stale X locks/sockets left by an unclean shutdown (e.g. the host being
# power-cut). At container start no Xvnc is alive, so every /tmp/.X*-lock is
# stale; without this the hub's `Xvnc :1` below dies with "Server is already
# active for display 1", 6901 never listens, and every isolated session shows a
# blank screen. (_spawn already clears per-session displays :2+; this covers the
# hub display :1, which entrypoint — not _spawn — starts.)
rm -f /tmp/.X*-lock 2>/dev/null || true
rm -f /tmp/.X11-unix/X* 2>/dev/null || true
# Hub: serves the static KasmVNC web client (HTML/assets) on the fixed port 6901.
# Its display is never rendered to (no window manager, no browser) — only
# per-session Xvnc instances carry live displays. The data-plane routes only the
# web client here; each live RFB-over-WebSocket goes to a per-session port.
Xvnc :1 -geometry 1280x800 -depth 24 -websocketPort 6901 -interface 0.0.0.0 \
  -httpd /usr/share/kasmvnc/www -SecurityTypes None -disableBasicAuth &
sleep 2
mkdir -p /kasmlog
python3 /control.py 2>&1 | tee /kasmlog/kasm.log
