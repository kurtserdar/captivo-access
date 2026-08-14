"use client";
import { useState } from "react";

// Admin viewer for an ISOLATED (KasmVNC) session: a second shared client to the same
// Xvnc via /kasm-view. Read-only vs control is the client-side view_only setting;
// toggling control reconnects the iframe (via the src key) in the new mode after the
// server records controlOwner.
export function KasmLiveViewer({ sessionId, canControl }: { sessionId: string; canControl: boolean }) {
  const [controlling, setControlling] = useState(false);
  const [busy, setBusy] = useState(false);
  const viewOnly = !controlling;
  const src = `/kasm-view/?session=${encodeURIComponent(sessionId)}&path=kasm-view/websockify&view_only=${viewOnly}`;

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
      <iframe key={src} title="Live session" src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} allow="clipboard-read; clipboard-write" />
      <div className="live-badge">● LIVE{controlling ? " · CONTROLLING" : ""}</div>
      {canControl && (
        <button type="button" className="btn sm live-control" disabled={busy} onClick={toggleControl}>
          {controlling ? "Release control" : "Take control"}
        </button>
      )}
    </div>
  );
}
