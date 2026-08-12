"use client";
import { useState } from "react";

type Verdict = { ok: boolean; count: number; brokenAtSeq: string | null; reason: string | null } | null;

export function AdminIntegrityPanel() {
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/audit/admin-verify");
      setVerdict((await res.json()) as Verdict);
    } catch {
      setVerdict({ ok: false, count: 0, brokenAtSeq: null, reason: "request_failed" });
    }
    setBusy(false);
  }

  return (
    <div className="aa-integrity">
      <button type="button" className="btn sm" onClick={verify} disabled={busy}>{busy ? "Verifying…" : "Verify chain"}</button>
      {verdict && (
        verdict.ok
          ? <span className="aa-ok">✓ Chain intact ({verdict.count} record{verdict.count === 1 ? "" : "s"})</span>
          : <span className="aa-bad">✗ Tampering detected{verdict.brokenAtSeq ? ` at #${verdict.brokenAtSeq}` : ""}{verdict.reason ? ` (${verdict.reason})` : ""}</span>
      )}
    </div>
  );
}
