"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

// Fullscreen HTML5 session: embeds guacamole-common-js and points it at the
// data-plane guac-tunnel (same origin, fronted by nginx). The server drives the
// guacd handshake + credential injection; this only renders + sends input.
export function GatewaySession({ siteId, recorded }: { siteId: string; recorded: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [controlHeld, setControlHeld] = useState(false);
  const guacRef = useRef<any>(null);
  const fsRef = useRef<any>(null);
  const [canUpload, setCanUpload] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fs = fsRef.current, G = guacRef.current;
    if (!fs || !G || !e.dataTransfer?.files?.length) return;
    for (const file of Array.from(e.dataTransfer.files)) {
      const stream = fs.createOutputStream(file.type || "application/octet-stream", "/" + file.name);
      const writer = new G.BlobWriter(stream);
      setToast(`Uploading ${file.name}…`);
      writer.oncomplete = () => setToast(`Uploaded ${file.name}`);
      writer.onerror = () => setToast(`Upload failed: ${file.name}`);
      writer.sendBlob(file);
    }
  };

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

      guacRef.current = Guacamole;
      client.onfile = (stream: any, mimetype: string, filename: string) => {
        if (!disposed) setToast(`Downloading ${filename}…`);
        const reader = new Guacamole.BlobReader(stream, mimetype);
        reader.onend = () => {
          const url = URL.createObjectURL(reader.getBlob());
          const a = document.createElement("a");
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          // Revoke only after the browser has had a chance to start the download —
          // revoking synchronously after click() cancels it silently.
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          if (!disposed) setToast(`Downloaded ${filename}`);
        };
      };
      client.onfilesystem = (object: any) => {
        fsRef.current = object;
        if (!disposed) setCanUpload(true);
      };

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
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden", cursor: "none" }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* Dedicated display target: the guac client clears this via innerHTML, so the
          overlays below must NOT live inside it (they'd be wiped on connect). */}
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      {recorded && (
        <div
          style={{
            position: "fixed", top: 12, left: 12, zIndex: 20, pointerEvents: "none",
            display: "flex", alignItems: "center", gap: 6,
            background: "rgba(0,0,0,0.6)", color: "#ff4d4f",
            font: "600 12px/1 sans-serif", letterSpacing: "0.06em",
            padding: "6px 10px", borderRadius: 6,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff4d4f", display: "inline-block" }} />
          RECORDED
        </div>
      )}
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
      {canUpload && <div className="ft-hint">Drop files to upload</div>}
      {toast && <div className="ft-toast">{toast}</div>}
      {error && (
        <div style={{ color: "#fff", padding: "1.25rem", fontFamily: "sans-serif" }}>{error}</div>
      )}
    </div>
  );
}
