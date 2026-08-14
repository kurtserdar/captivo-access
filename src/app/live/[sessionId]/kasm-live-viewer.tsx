"use client";
import { useEffect, useRef, useState } from "react";
import { ConnectSplash } from "@/app/gateway/[siteId]/session/connect-splash";

// Admin viewer for an ISOLATED (KasmVNC) session: a second shared client to the same
// Xvnc via /kasm-view. Read-only vs control is the client-side view_only setting;
// toggling control reconnects the iframe (via the src key) in the new mode after the
// server records controlOwner. A branded splash covers every (re)connect — initial,
// take-control, and release — until the KasmVNC client actually connects, so its own
// loading splash never shows through.
export function KasmLiveViewer({ sessionId, canControl, label }: { sessionId: string; canControl: boolean; label?: string }) {
  const [controlling, setControlling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const viewOnly = !controlling;
  const src = `/kasm-view/?session=${encodeURIComponent(sessionId)}&path=kasm-view/websockify&view_only=${viewOnly}`;

  // Reset + poll for connection on every (re)connect. The iframe is same-origin
  // (/kasm-view is under the manager host), so we can read its documentElement for
  // the KasmVNC `noVNC_connected` class. A 20 s fallback never traps the viewer.
  useEffect(() => {
    setReady(false);
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
  }, [src]);

  async function toggleControl() {
    setBusy(true);
    const action = controlling ? "release" : "take";
    try {
      const res = await fetch(`/api/admin/live/${sessionId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // 200 => granted/released; 409 => control held by another admin (stay read-only).
      if (res.ok) setControlling(action === "take");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      <iframe key={src} ref={frameRef} title="Live session" src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} allow="clipboard-read; clipboard-write" />
      {!ready && <ConnectSplash siteName={label ?? "Isolated session"} />}
      <div className="live-badge" style={{ zIndex: 60 }}>● LIVE{controlling ? " · CONTROLLING" : ""}</div>
      {canControl && (
        <button type="button" className="btn sm live-control" style={{ zIndex: 60 }} disabled={busy} onClick={toggleControl}>
          {controlling ? "Release control" : "Take control"}
        </button>
      )}
    </div>
  );
}
