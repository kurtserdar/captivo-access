"use client";
import { useState } from "react";
import type { PlatformSettings } from "@/lib/settings/platform";

function str(n: number | null): string {
  return n == null ? "" : String(n);
}

export function PlatformSettingsForm({ initial }: { initial: PlatformSettings }) {
  const [audit, setAudit] = useState(str(initial.auditRetentionDays));
  const [invite, setInvite] = useState(str(initial.inviteTtlHours));
  const [webhook, setWebhook] = useState(initial.notificationWebhookUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function save() {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/policy/platform", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auditRetentionDays: audit, inviteTtlHours: invite, notificationWebhookUrl: webhook }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice(res.ok && body.ok ? { kind: "ok", msg: "Saved." } : { kind: "err", msg: "Could not save." });
  }

  return (
    <div>
      <div className="field">
        <label className="field-label" htmlFor="ps-audit">Audit log retention (days)</label>
        <input id="ps-audit" type="number" min={0} className="input" value={audit} onChange={(e) => setAudit(e.target.value)} placeholder="Empty = default 730" />
        <span className="hint">Older audit rows are trimmed by the retention cron, preserving the tamper-evident chain. <code>0</code> keeps nothing beyond today; empty uses the default (730).</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ps-invite">Invitation link lifetime (hours)</label>
        <input id="ps-invite" type="number" min={1} className="input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Empty = default 48" />
        <span className="hint">How long a new invite link stays valid before it expires.</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ps-webhook">Notification webhook URL</label>
        <input id="ps-webhook" type="url" className="input" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.slack.com/… (empty = disabled)" />
        <span className="hint">Site up/down events POST here (Slack/Teams-friendly JSON), in addition to the in-console bell. Leave empty to disable.</span>
      </div>
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>}
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
