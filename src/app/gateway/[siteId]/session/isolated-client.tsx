"use client";
import { useEffect, useRef, useState } from "react";
import { ConnectSplash } from "./connect-splash";

// ?site pins the session for the data-plane; it sets a cookie so the KasmVNC
// client's follow-up asset/WS requests (which carry no ?site) inherit it.
// path= keeps the client's RFB WebSocket under /kasm-tunnel/ (its default absolute
// /websockify would route to the manager, not the data-plane). clipboard_* turn ON
// the client's seamless clipboard (OFF by default); per-direction policy is still
// enforced server-side by the broker's DLP config.
// resize=scale (not remote): the isolated desktop stays a fixed 1280x800 and the
// client scales it to fill the viewport. resize=remote grew the desktop past the
// recorder's fixed 1280x800 x11grab region, so recordings only captured the top-left
// corner — scale keeps the desktop size and the recording in lockstep while still
// filling the screen (16:10 matches, no letterbox).
const KASM_PARAMS = "path=kasm-tunnel/websockify&resize=scale&clipboard_seamless=true&clipboard_up=true&clipboard_down=true";

export function IsolatedSession({ siteId, siteName, recorded }: { siteId: string; siteName: string; recorded: boolean }) {
  const [ready, setReady] = useState(false);
  const [watching, setWatching] = useState(false);
  const [controlHeld, setControlHeld] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Mirror GatewaySession: poll whether an admin is watching / has taken control so
  // the vendor sees a live-monitoring notice (transparency / KVKK).
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/gateway/${siteId}/watch-status`, { cache: "no-store" });
        if (res.ok) {
          const s = (await res.json()) as { watching: boolean; controlHeld: boolean };
          if (!stop) { setWatching(s.watching); setControlHeld(s.controlHeld); }
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [siteId]);

  useEffect(() => {
    // Keep our branded splash up until the embedded KasmVNC client actually
    // CONNECTS — it adds `noVNC_connected` to its documentElement then. Dismissing
    // on iframe onLoad instead (document ready, but not yet connected) would
    // uncover KasmVNC's own "connecting" splash underneath. The iframe is
    // same-origin (/kasm-tunnel is under the manager host), so we can read its
    // document. A 20 s fallback guarantees we never trap the vendor behind it.
    const isConnected = () => {
      try {
        return !!frameRef.current?.contentDocument?.documentElement.classList.contains("noVNC_connected");
      } catch {
        return false;
      }
    };
    const poll = window.setInterval(() => {
      if (isConnected()) { window.clearInterval(poll); setReady(true); }
    }, 250);
    const fallback = window.setTimeout(() => { window.clearInterval(poll); setReady(true); }, 20000);
    return () => { window.clearInterval(poll); window.clearTimeout(fallback); };
  }, []);

  return (
    <>
      <iframe
        ref={frameRef}
        title="Isolated browser"
        src={`/kasm-tunnel/?site=${siteId}&${KASM_PARAMS}`}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
        allow="clipboard-read; clipboard-write"
      />
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
            pointerEvents: "none",
            background: controlHeld ? "rgba(180,0,0,0.92)" : "rgba(0,0,0,0.72)",
            color: "#fff", padding: "6px 14px", borderRadius: 8, fontFamily: "sans-serif", fontSize: "13px", whiteSpace: "nowrap",
          }}
        >
          {controlHeld ? "An administrator has taken control of this session." : "This session is being monitored live."}
        </div>
      )}
      {!ready && <ConnectSplash siteName={siteName} />}
    </>
  );
}
