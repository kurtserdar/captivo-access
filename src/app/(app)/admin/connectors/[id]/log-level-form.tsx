"use client";
import { useState } from "react";

const LEVELS = [
  { value: "error", label: "Error — failures only" },
  { value: "warn", label: "Warn — failures + anomalies (denials, slow, unreachable)" },
  { value: "info", label: "Info — normal operation (recommended)" },
  { value: "debug", label: "Debug — per-request detail (verbose; troubleshooting only)" },
];

export function LogLevelForm({ connectorId, initial, globalDefault }: { connectorId: string; initial: string | null; globalDefault: string }) {
  const [value, setValue] = useState(initial ?? ""); // "" = use fleet default
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function save() {
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/admin/connectors/${connectorId}/log-level`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logLevel: value }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !body.ok) {
      setNotice({ kind: "err", msg: "Could not save the log level." });
      return;
    }
    setNotice({
      kind: "ok",
      msg: body.live ? "Saved and applied live." : "Saved — will apply when the connector is online.",
    });
  }

  return (
    <div>
      <p className="cell-sub" style={{ marginTop: 0 }}>
        How much this connector logs (shown under <b>Recent logs</b> below). Pushed live over the control stream — no
        redeploy. <b>Use default</b> follows the fleet default set on the <b>Policy</b> page; any explicit level here
        overrides it for this connector. <b>Debug</b> logs every request (verbose, short troubleshooting only).
      </p>
      <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Use default ({globalDefault})</option>
        {LEVELS.map((l) => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>
      {notice && (
        <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>
      )}
      <div className="row-actions" style={{ marginTop: ".6rem" }}>
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save log level"}
        </button>
      </div>
    </div>
  );
}
