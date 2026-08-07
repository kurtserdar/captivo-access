"use client";

import { useState } from "react";

type Repaired = { code: string; reconfigureCommand: string; managerUrlIsLocal: boolean };

export function RepairConnectorButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [invalidateNow, setInvalidateNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Repaired | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors/${id}/repair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invalidateNow }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.code) {
        setError(body?.error === "not_repairable" ? "A revoked connector can't be re-paired." : "Couldn't generate a re-pair code, please try again.");
        return;
      }
      setResult({ code: body.code, reconfigureCommand: body.reconfigureCommand, managerUrlIsLocal: Boolean(body.managerUrlIsLocal) });
    } catch {
      setError("Couldn't generate a re-pair code, please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.reconfigureCommand);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (result) {
    return (
      <div role="status" className="notice">
        <p>
          This re-pair code is shown only once — it&apos;s embedded in the command below. Run it on the
          connector&apos;s host to rotate its token; the connector keeps its identity and its sites.
        </p>
        <code className="code secret">{result.reconfigureCommand}</code>
        <button type="button" className="btn sm ghost" onClick={copy}>{copied ? "Copied" : "Copy command"}</button>
        {result.managerUrlIsLocal && (
          <p className="notice error">
            <code>MANAGER_URL</code> points at <code>localhost</code> — replace it with the manager&apos;s
            real address (set <code>MANAGER_PUBLIC_URL</code> in the server&apos;s <code>.env</code>).
          </p>
        )}
      </div>
    );
  }

  if (!open) {
    return <button type="button" className="btn sm" onClick={() => setOpen(true)}>Re-pair</button>;
  }

  return (
    <div>
      <label className="field-label" style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
        <input type="checkbox" checked={invalidateNow} onChange={(e) => setInvalidateNow(e.target.checked)} />
        Invalidate the current token now (connector goes offline until re-paired)
      </label>
      <p className="cell-sub">
        Off: the current token keeps working until you redeem the new code (zero-downtime handoff). On: the
        current token dies immediately (use if it may be compromised).
      </p>
      <div className="row-actions">
        <button type="button" className="btn sm primary" disabled={busy} onClick={generate}>
          {busy ? "Generating…" : "Generate code"}
        </button>
        <button type="button" className="btn sm" disabled={busy} onClick={() => { setOpen(false); setInvalidateNow(false); setError(null); }}>Cancel</button>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}
