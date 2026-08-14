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
  const mounted = useRef(0);

  useEffect(() => {
    mounted.current = Date.now();
    // Fallback: never leave the vendor stuck behind the splash if the browser
    // never fires onLoad — reveal the real canvas/error after 20 s.
    const t = setTimeout(() => setReady(true), 20000);
    return () => clearTimeout(t);
  }, []);

  // Keep the splash up for at least 600 ms so a fast load does not flash it.
  const onLoad = () => {
    const wait = Math.max(0, 600 - (Date.now() - mounted.current));
    setTimeout(() => setReady(true), wait);
  };

  return (
    <>
      <iframe
        title="Isolated browser"
        src={`/kasm-tunnel/?site=${siteId}&${KASM_PARAMS}`}
        onLoad={onLoad}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
        allow="clipboard-read; clipboard-write"
      />
      {!ready && <ConnectSplash siteName={siteName} />}
    </>
  );
}
