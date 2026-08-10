"use client";
import { useState } from "react";
import type { SessionPolicy } from "@/lib/policy/session-policy";

function str(n: number | null): string {
  return n == null ? "" : String(n);
}

export function SessionPolicyForm({ initial }: { initial: SessionPolicy }) {
  const [idle, setIdle] = useState(str(initial.idleTimeoutMinutes));
  const [maxHours, setMaxHours] = useState(str(initial.maxSessionHours));
  const [maxConc, setMaxConc] = useState(str(initial.maxConcurrentPerUser));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function save() {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/policy/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idleTimeoutMinutes: idle, maxSessionHours: maxHours, maxConcurrentPerUser: maxConc }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice(res.ok && body.ok ? { kind: "ok", msg: "Saved." } : { kind: "err", msg: "Could not save." });
  }

  return (
    <div>
      <div className="field">
        <label className="field-label" htmlFor="sp-idle">Idle timeout (minutes)</label>
        <input id="sp-idle" type="number" min={1} className="input" value={idle} onChange={(e) => setIdle(e.target.value)} placeholder="Empty = no idle timeout" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="sp-hours">Max session lifetime (hours)</label>
        <input id="sp-hours" type="number" min={1} className="input" value={maxHours} onChange={(e) => setMaxHours(e.target.value)} placeholder="Empty = 12h default" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="sp-conc">Max concurrent sessions per user</label>
        <input id="sp-conc" type="number" min={1} className="input" value={maxConc} onChange={(e) => setMaxConc(e.target.value)} placeholder="Empty = unlimited" />
      </div>
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>}
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
