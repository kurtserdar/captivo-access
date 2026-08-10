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
      <div className="settings">
        <div className="setting">
          <div className="setting-main">
            <div className="setting-label">Idle timeout</div>
            <div className="setting-hint">End a session after this long with no activity. Empty = no idle timeout.</div>
          </div>
          <div className="setting-ctl">
            <input type="number" min={1} className="input" style={{ width: "5rem" }} value={idle} onChange={(e) => setIdle(e.target.value)} placeholder="—" aria-label="Idle timeout minutes" />
            <span className="unit">min</span>
          </div>
        </div>
        <div className="setting">
          <div className="setting-main">
            <div className="setting-label">Max session lifetime</div>
            <div className="setting-hint">Absolute lifetime of a login, cookie included. Empty = 12h default.</div>
          </div>
          <div className="setting-ctl">
            <input type="number" min={1} className="input" style={{ width: "5rem" }} value={maxHours} onChange={(e) => setMaxHours(e.target.value)} placeholder="12" aria-label="Max session lifetime hours" />
            <span className="unit">hours</span>
          </div>
        </div>
        <div className="setting">
          <div className="setting-main">
            <div className="setting-label">Max concurrent sessions</div>
            <div className="setting-hint">Per user — the oldest session is evicted past the cap. Empty = unlimited.</div>
          </div>
          <div className="setting-ctl">
            <input type="number" min={1} className="input" style={{ width: "5rem" }} value={maxConc} onChange={(e) => setMaxConc(e.target.value)} placeholder="∞" aria-label="Max concurrent sessions per user" />
            <span className="unit">sessions</span>
          </div>
        </div>
      </div>
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert" style={{ marginTop: "1rem" }}>{notice.msg}</p>}
      <div className="row-actions" style={{ marginTop: "1.1rem" }}>
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}
