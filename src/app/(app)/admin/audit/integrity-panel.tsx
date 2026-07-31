"use client";

import { useState } from "react";

type Result = {
  ok: boolean;
  count: number;
  firstSeq: string | null;
  lastSeq: string | null;
  retentionBoundary: boolean;
  brokenAtSeq: string | null;
  reason: string | null;
};

export function IntegrityPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/audit/verify");
      if (!res.ok) {
        setError("Integrity check request failed.");
        return;
      }
      setResult((await res.json()) as Result);
    } catch {
      setError("Integrity check request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "16px" }}>
      <div className="card-head">
        <h2>Integrity</h2>
        <button className="btn sm" onClick={check} disabled={loading}>
          {loading ? "Checking…" : "Check integrity"}
        </button>
      </div>
      {error && <p className="notice error">{error}</p>}
      {result && result.ok && (
        <p className="pill ok">
          ✓ Audit log verified intact — {result.count} events
          {result.firstSeq && result.lastSeq ? ` (seq ${result.firstSeq}–${result.lastSeq})` : ""}
          {result.retentionBoundary ? " · earlier events purged by retention" : ""}
        </p>
      )}
      {result && !result.ok && (
        <p className="pill danger">
          ⚠ Integrity check failed at seq {result.brokenAtSeq} ({result.reason})
        </p>
      )}
    </div>
  );
}
