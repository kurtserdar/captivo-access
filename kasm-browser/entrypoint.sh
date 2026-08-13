#!/bin/sh
set -e
export DISPLAY=:1
mkdir -p /root/.vnc
cp /kasmvnc.yaml /root/.vnc/kasmvnc.yaml
# KasmVNC's Xvnc IS the display server + VNC + web/WS server on one port (6901).
# Internal-only: no SSL, no auth (access is grant-checked at the tunnel entry).
Xvnc :1 -geometry 1280x800 -depth 24 -websocketPort 6901 -interface 0.0.0.0 \
  -httpd /usr/share/kasmvnc/www -SecurityTypes None -disableBasicAuth &
sleep 2
fluxbox >/dev/null 2>&1 &
exec python3 /control.py
