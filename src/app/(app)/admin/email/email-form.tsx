"use client";
import { useState } from "react";

type Initial = {
  host: string; port: number; secure: boolean; username: string;
  fromName: string; fromEmail: string; enabled: boolean; hasPassword: boolean;
};

export function EmailForm({ initial, adminEmail }: { initial: Initial; adminEmail: string }) {
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [secure, setSecure] = useState(initial.secure);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [fromName, setFromName] = useState(initial.fromName);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState(adminEmail);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port: Number(port), secure, username, password, fromName, fromEmail, enabled }),
      });
      if (res.ok) { setNotice({ kind: "ok", msg: "Saved." }); setPassword(""); }
      else setNotice({ kind: "error", msg: "Couldn't save — check the fields." });
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true);
    setNotice(null);
    try {
      const saveRes = await fetch("/api/admin/smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port: Number(port), secure, username, password, fromName, fromEmail, enabled }),
      });
      if (!saveRes.ok) {
        setNotice({ kind: "error", msg: "Couldn't save — check the fields." });
        return;
      }
      setPassword("");
      const res = await fetch("/api/admin/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const r = (await res.json().catch(() => ({}))) as { sent?: boolean; reason?: string };
      const messages: Record<string, string> = {
        disabled: "Saved, but email is turned off — tick 'Enabled' and save first.",
        not_configured: "Configure and save your SMTP settings first.",
      };
      setNotice(
        r.sent
          ? { kind: "ok", msg: `Saved. Test email sent to ${testTo}.` }
          : { kind: "error", msg: (r.reason && messages[r.reason]) || `Test failed: ${r.reason ?? "unknown"}.` },
      );
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save}>
      <div className="field"><label className="field-label" htmlFor="smtp-host">SMTP host</label>
        <input id="smtp-host" className="input" value={host} onChange={(e) => setHost(e.target.value)} required /></div>
      <div className="field"><label className="field-label" htmlFor="smtp-port">Port</label>
        <input id="smtp-port" type="number" className="input" value={port} onChange={(e) => setPort(e.target.value)} required /></div>
      <div className="field"><label className="field-label">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} /> Implicit TLS (port 465). Leave off for STARTTLS (587).</label></div>
      <div className="field"><label className="field-label" htmlFor="smtp-user">Username</label>
        <input id="smtp-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></div>
      <div className="field"><label className="field-label" htmlFor="smtp-pass">Password</label>
        <input id="smtp-pass" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
          placeholder={initial.hasPassword ? "•••••••• (leave blank to keep current)" : ""} />
        <span className="hint">Stored encrypted; never shown again.</span></div>
      <div className="field"><label className="field-label" htmlFor="smtp-fromname">From name</label>
        <input id="smtp-fromname" className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} /></div>
      <div className="field"><label className="field-label" htmlFor="smtp-fromemail">From email</label>
        <input id="smtp-fromemail" type="email" className="input" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} required /></div>
      <div className="setting" style={{ margin: ".4rem 0 1.1rem" }}>
        <div className="setting-main">
          <div className="setting-label">Send email using these settings</div>
          <div className="setting-hint">When off, invites and alerts fall back to copyable links / the in-console bell only.</div>
        </div>
        <div className="setting-ctl">
          <label className="switch"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span className="track" /></label>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="smtp-testto">Send test to</label>
        <input id="smtp-testto" type="email" className="input" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
      </div>
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>}
      <div className="row-actions">
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "…" : "Save"}</button>
        <button type="button" className="btn" onClick={sendTest} disabled={busy}>{busy ? "…" : "Save & send test"}</button>
      </div>
    </form>
  );
}
