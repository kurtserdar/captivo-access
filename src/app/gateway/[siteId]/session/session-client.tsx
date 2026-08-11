"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

// Fullscreen HTML5 session: embeds guacamole-common-js and points it at the
// data-plane guac-tunnel (same origin, fronted by nginx). The server drives the
// guacd handshake + credential injection; this only renders + sends input.
export function GatewaySession({ siteId }: { siteId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [controlHeld, setControlHeld] = useState(false);

  useEffect(() => {
    let client: any;
    let keyboard: any;
    let onResize: (() => void) | null = null;
    let disposed = false;

    (async () => {
      const mod: any = await import("guacamole-common-js");
      const Guacamole = mod.default ?? mod;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      // The tunnel URL must carry NO query — guacamole-common-js appends "?"+data.
      const tunnel = new Guacamole.WebSocketTunnel(`${proto}://${window.location.host}/guac-tunnel`);
      client = new Guacamole.Client(tunnel);
      const fail = () => setError("The session ended or could not start.");
      tunnel.onerror = fail;
      client.onerror = fail;

      const display = client.getDisplay();
      const el = display.getElement();
      if (ref.current) {
        ref.current.innerHTML = "";
        ref.current.appendChild(el);
      }
      if (disposed) return;

      const vw = () => Math.floor(window.innerWidth);
      const vh = () => Math.floor(window.innerHeight);
      // Fixed 96 DPI (100% scale). Multiplying by devicePixelRatio (e.g. 2 on a
      // Retina Mac) made the RDP target render at 200% — icons/text too large.
      const dpi = 96;

      // Scale the rendered display to exactly fit the viewport.
      const fit = () => {
        const dw = display.getWidth();
        const dh = display.getHeight();
        if (dw > 0 && dh > 0) display.scale(Math.min(window.innerWidth / dw, window.innerHeight / dh));
      };
      display.onresize = fit;

      client.connect(`site=${encodeURIComponent(siteId)}&w=${vw()}&h=${vh()}&dpi=${dpi}`);

      keyboard = new Guacamole.Keyboard(document);
      keyboard.onkeydown = (k: number) => client.sendKeyEvent(1, k);
      keyboard.onkeyup = (k: number) => client.sendKeyEvent(0, k);

      const mouse = new Guacamole.Mouse(el);
      const send = (state: any) => client.sendMouseState(state);
      mouse.onmousedown = send;
      mouse.onmouseup = send;
      mouse.onmousemove = send;

      // On window resize, ask the remote to match the new viewport, then refit.
      onResize = () => {
        try {
          client.sendSize(vw(), vh());
        } catch {
          /* ignore */
        }
        fit();
      };
      window.addEventListener("resize", onResize);
      fit();
    })().catch(() => setError("Couldn't start the session."));

    return () => {
      disposed = true;
      try {
        if (onResize) window.removeEventListener("resize", onResize);
        if (keyboard) {
          keyboard.onkeydown = null;
          keyboard.onkeyup = null;
        }
        client?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [siteId]);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/gateway/${siteId}/watch-status`, { cache: "no-store" });
        if (res.ok) {
          const s = (await res.json()) as { watching: boolean; controlHeld: boolean };
          if (!stop) {
            setWatching(s.watching);
            setControlHeld(s.controlHeld);
          }
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [siteId]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden", cursor: "none" }}
    >
      {(watching || controlHeld) && (
        <div
          style={{
            position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 20,
            pointerEvents: "none", // never intercept clicks — they must reach the session (e.g. the window close button)
            background: controlHeld ? "rgba(180,0,0,0.92)" : "rgba(0,0,0,0.72)",
            color: "#fff", padding: "6px 14px", borderRadius: 8, fontFamily: "sans-serif", fontSize: "13px", whiteSpace: "nowrap",
          }}
        >
          {controlHeld ? "An administrator has taken control of this session." : "This session is being monitored live."}
        </div>
      )}
      {error && (
        <div style={{ color: "#fff", padding: "1.25rem", fontFamily: "sans-serif" }}>{error}</div>
      )}
    </div>
  );
}
