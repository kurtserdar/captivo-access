"use client";
import { useEffect, useRef, useState } from "react";
import { ConnectSplash } from "./connect-splash";

// ?site pins the session for the data-plane; it sets a cookie so the KasmVNC
// client's follow-up asset/WS requests (which carry no ?site) inherit it.
// path= keeps the client's RFB WebSocket under /kasm-tunnel/ (its default absolute
// /websockify would route to the manager, not the data-plane). clipboard_* turn ON
// the client's seamless clipboard (OFF by default); per-direction policy is still
// enforced server-side by the broker's DLP config.
const KASM_PARAMS = "path=kasm-tunnel/websockify&clipboard_seamless=true&clipboard_up=true&clipboard_down=true";

export function IsolatedSession({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

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
      {!ready && <ConnectSplash siteName={siteName} />}
    </>
  );
}
