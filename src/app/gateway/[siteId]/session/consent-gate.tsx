"use client";
import { useState } from "react";
import { GatewaySession } from "./session-client";

export function ConsentGate({ siteId, recorded }: { siteId: string; recorded: boolean }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await fetch(`/api/gateway/${siteId}/consent`, { method: "POST" });
    } catch {
      /* audit is best-effort; proceed regardless */
    }
    setAccepted(true);
  }

  if (accepted) return <GatewaySession siteId={siteId} recorded={recorded} />;

  return (
    <div className="consent-gate">
      <div className="consent-card">
        <h1>This session is recorded</h1>
        <p>
          For security and compliance, your activity in this remote session is
          recorded. Continue only if you consent to being recorded.
        </p>
        <button type="button" className="btn primary" disabled={busy} onClick={accept}>
          {busy ? "Starting…" : "I understand — connect"}
        </button>
      </div>
    </div>
  );
}
