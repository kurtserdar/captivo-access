"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

// Embeds the guacamole-common-js HTML5 client and points it at the data-plane
// guac-tunnel (same origin, fronted by nginx). The server drives the guacd
// handshake + credential injection; this component only renders + sends input.
export function GatewaySession({ siteId }: { siteId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let client: any;
    let keyboard: any;
    let disposed = false;
    (async () => {
      const mod: any = await import("guacamole-common-js");
      const Guacamole = mod.default ?? mod;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/guac-tunnel?site=${encodeURIComponent(siteId)}`;
      const tunnel = new Guacamole.WebSocketTunnel(url);
      client = new Guacamole.Client(tunnel);
      const fail = () => setError("The session ended or could not start.");
      tunnel.onerror = fail;
      client.onerror = fail;

      const el = client.getDisplay().getElement();
      if (ref.current) {
        ref.current.innerHTML = "";
        ref.current.appendChild(el);
      }
      if (disposed) return;
      client.connect("");

      keyboard = new Guacamole.Keyboard(document);
      keyboard.onkeydown = (k: number) => client.sendKeyEvent(1, k);
      keyboard.onkeyup = (k: number) => client.sendKeyEvent(0, k);

      const mouse = new Guacamole.Mouse(el);
      const send = (state: any) => client.sendMouseState(state);
      mouse.onmousedown = send;
      mouse.onmouseup = send;
      mouse.onmousemove = send;
    })().catch(() => setError("Couldn't start the session."));

    return () => {
      disposed = true;
      try {
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

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      {error && (
        <div style={{ color: "#fff", padding: "1.25rem", fontFamily: "sans-serif" }}>{error}</div>
      )}
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
