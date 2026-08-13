#!/bin/sh
set -e
export DISPLAY=:1
Xvfb :1 -screen 0 1280x800x24 -nolisten tcp &
sleep 1
fluxbox >/dev/null 2>&1 &
x11vnc -display :1 -forever -shared -nopw -rfbport 5900 -quiet -bg
exec python3 /control.py
