"use client";
import { useState } from "react";
import type { PlatformSettings } from "@/lib/settings/platform";

function str(n: number | null): string {
  return n == null ? "" : String(n);
}

export function PlatformSettingsForm({ initial, consentEffective }: { initial: PlatformSettings; consentEffective: boolean }) {
  const [audit, setAudit] = useState(str(initial.auditRetentionDays));
  const [invite, setInvite] = useState(str(initial.inviteTtlHours));
  const [webhook, setWebhook] = useState(initial.notificationWebhookUrl ?? "");
  const [ipAllow, setIpAllow] = useState(initial.vendorIpAllowlist ?? "");
  const [maxGrant, setMaxGrant] = useState(str(initial.maxGrantDays));
  const [consent, setConsent] = useState(consentEffective);
  const [recRetention, setRecRetention] = useState(str(initial.recordingRetentionDays));
  const [connLog, setConnLog] = useState(initial.defaultConnectorLogLevel ?? "info");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function resetAllConnectors() {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/policy/connector-log-level/reset-all", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice(
      res.ok && body.ok
        ? { kind: "ok", msg: `Reset ${body.count ?? 0} connector(s) to the default (save the default first if you just changed it).` }
        : { kind: "err", msg: "Could not reset connectors." },
    );
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/policy/platform", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        auditRetentionDays: audit,
        inviteTtlHours: invite,
        notificationWebhookUrl: webhook,
        vendorIpAllowlist: ipAllow,
        maxGrantDays: maxGrant,
        recordingConsentRequired: consent,
        recordingRetentionDays: recRetention,
        defaultConnectorLogLevel: connLog,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && body.ok) {
      setNotice({ kind: "ok", msg: "Saved." });
    } else if (body.error === "invalid_cidr") {
      setNotice({ kind: "err", msg: `Invalid IP/CIDR entries: ${(body.invalid ?? []).join(", ")}` });
    } else if (body.error === "invalid_webhook_url") {
      setNotice({ kind: "err", msg: "The webhook URL must be a valid http(s) URL." });
    } else {
      setNotice({ kind: "err", msg: "Could not save." });
    }
  }

  return (
    <div>
      <div className="field">
        <label className="field-label" htmlFor="ps-audit">Audit log retention (days)</label>
        <input id="ps-audit" type="number" min={0} className="input" value={audit} onChange={(e) => setAudit(e.target.value)} placeholder="Empty = default 730" />
        <span className="hint">Older audit rows are trimmed by the retention cron, preserving the tamper-evident chain. <code>0</code> keeps nothing beyond today; empty uses the default (730).</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ps-recret">Session recording retention (days)</label>
        <input id="ps-recret" type="number" min={1} className="input" value={recRetention} onChange={(e) => setRecRetention(e.target.value)} placeholder="Empty = keep forever" />
        <span className="hint">Recorded vendor sessions older than this are deleted by the recording-retention cron (the deletion is audited). Empty = kept indefinitely. Requires the <code>/api/cron/recording-retention</code> job to be scheduled.</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ps-connlog">Default connector log level</label>
        <select id="ps-connlog" className="select" value={connLog} onChange={(e) => setConnLog(e.target.value)}>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <span className="hint">
          The level for connectors set to &quot;Use default&quot; on their detail page. A connector with its own explicit
          level overrides this. Saved with the form below; use <b>Reset all</b> to switch every connector back to this
          default at once (pushed live to online ones).
        </span>
        <div className="row-actions" style={{ marginTop: ".4rem" }}>
          <button type="button" className="btn sm" disabled={busy} onClick={resetAllConnectors}>Reset all connectors to default</button>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ps-maxgrant">Maximum grant duration (days)</label>
        <input id="ps-maxgrant" type="number" min={1} className="input" value={maxGrant} onChange={(e) => setMaxGrant(e.target.value)} placeholder="Empty = no cap (permanent grants allowed)" />
        <span className="hint">When set, no grant or access request may last longer than this, and every grant must have an end date — enforcing time-boxed vendor access. Existing grants are unaffected until edited.</span>
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
      <div className="field">
        <label className="field-label">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{" "}
          Require recording consent
        </label>
        <span className="hint">On recorded sites, show the vendor a one-time &quot;this session is recorded&quot; acknowledgement (once per browser session) before any app content loads. Off by default — the recording banner and the &quot;Recorded&quot; label are always shown regardless.</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ps-ipallow">Vendor source-IP allowlist</label>
        <textarea id="ps-ipallow" className="textarea" rows={3} value={ipAllow} onChange={(e) => setIpAllow(e.target.value)} placeholder="e.g. 203.0.113.0/24, 198.51.100.10, 2001:db8::/32" />
        <span className="hint">
          Comma / space / newline-separated <code>CIDR</code> or IP. When set, vendors can reach published
          <b> sites</b> only from these networks (checked live on every request; the console itself is not
          restricted, so you can&apos;t lock yourself out of admin). <b>Empty = no restriction.</b>{" "}
          <b>Include your own network</b> or you&apos;ll be blocked from opening sites too. The source IP is the one
          your front proxy records — spoofing an <code>X-Forwarded-For</code> won&apos;t bypass it.
        </span>
      </div>
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>}
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
