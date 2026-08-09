"use client";
import { useState } from "react";

export function EgressPolicyForm({ connectorId, initial }: { connectorId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function save() {
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/admin/connectors/${connectorId}/egress-policy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ egressAllowedTargets: value }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !body.ok) {
      setNotice({ kind: "err", msg: "Could not save the policy." });
      return;
    }
    setNotice({ kind: "ok", msg: body.live ? "Saved and applied live." : "Saved — will apply when the connector is online." });
  }

  return (
    <div>
      <p className="cell-sub" style={{ marginTop: 0 }}>
        Comma / space / newline-separated <code>CIDR</code>, <code>host</code>, or <code>host:port</code>. This can
        only <b>further restrict</b> the connector&apos;s local <code>ALLOWED_TARGETS</code> ceiling — leaving it
        empty applies no extra restriction. Applied live; no redeploy.
      </p>
      <textarea
        className="textarea"
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. 10.0.5.0/24, db.internal:5432"
      />
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>}
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save policy"}</button>
      </div>
    </div>
  );
}
