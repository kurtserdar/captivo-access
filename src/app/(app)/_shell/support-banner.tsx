"use client";

import { useState } from "react";
import { LocalTime } from "./local-time";

// Shown at the top of a tenant console while a platform support session is live.
export function SupportBanner({ expiresAt, actorEmail, reason }: { expiresAt: string; actorEmail: string; reason: string }) {
  const [busy, setBusy] = useState(false);
  async function end() {
    setBusy(true);
    try { await fetch("/api/support/end", { method: "POST" }); } finally { window.location.href = "/login"; }
  }
  return (
    <div className="update-banner" role="status" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
      <span><b>Platform support session</b> · {actorEmail}{reason ? ` · ${reason}` : ""} · ends <LocalTime iso={expiresAt} mode="time" /></span>
      <button type="button" className="btn sm" disabled={busy} onClick={end}>{busy ? "Ending…" : "End session now"}</button>
    </div>
  );
}
