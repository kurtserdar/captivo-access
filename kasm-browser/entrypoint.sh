#!/bin/sh
set -e
mkdir -p /root/.vnc
cp /kasmvnc.yaml /root/.vnc/kasmvnc.yaml
# Hub: serves the static KasmVNC web client (HTML/assets) on the fixed port 6901.
# Its display is never rendered to (no window manager, no browser) — only
# per-session Xvnc instances carry live displays. The data-plane routes only the
# web client here; each live RFB-over-WebSocket goes to a per-session port.
Xvnc :1 -geometry 1280x800 -depth 24 -websocketPort 6901 -interface 0.0.0.0 \
  -httpd /usr/share/kasmvnc/www -SecurityTypes None -disableBasicAuth &
sleep 2
mkdir -p /kasmlog
python3 /control.py 2>&1 | tee /kasmlog/kasm.log
