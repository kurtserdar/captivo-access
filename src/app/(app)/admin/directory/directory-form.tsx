"use client";
import { useState } from "react";

type Security = "PLAIN" | "STARTTLS" | "LDAPS";
type Initial = {
  enabled: boolean;
  connectorId: string;
  host: string;
  port: number;
  security: Security;
  insecureSkipVerify: boolean;
  baseDN: string;
  bindDN: string;
  hasBindPassword: boolean;
};

export function DirectoryForm({ initial, connectors }: { initial: Initial; connectors: { id: string; name: string }[] }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [connectorId, setConnectorId] = useState(initial.connectorId || connectors[0]?.id || "");
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [security, setSecurity] = useState<Security>(initial.security);
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(initial.insecureSkipVerify);
  const [baseDN, setBaseDN] = useState(initial.baseDN);
  const [bindDN, setBindDN] = useState(initial.bindDN);
  const [bindPassword, setBindPassword] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled, connectorId, host, port: Number(port) || 389, security, insecureSkipVerify, baseDN, bindDN,
          bindPassword: bindPassword || undefined,
        }),
      });
      if (res.ok) {
        setNotice({ kind: "ok", msg: "Saved." });
        setBindPassword("");
      } else {
        setNotice({ kind: "error", msg: "Couldn't save — check the fields." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/directory/test", { method: "POST", headers: { "Content-Type": "application/json" } });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
      if (j.ok) {
        setNotice({ kind: "ok", msg: j.detail || "Directory reachable — bind succeeded." });
      } else {
        setNotice({ kind: "error", msg: j.detail || j.error || "Couldn't reach the directory." });
      }
    } finally {
      setBusy(false);
    }
  }

  if (connectors.length === 0) {
    return <p className="cell-sub">Add a connector first — the directory is reached through one.</p>;
  }

  return (
    <form onSubmit={save}>
      <div className="setting" style={{ marginBottom: "1.1rem" }}>
        <div className="setting-main">
          <div className="setting-label">Enable directory integration</div>
          <div className="setting-hint">Sign in via your LDAP/Active Directory and map groups to roles or sites. When off, the settings below are kept but not used.</div>
        </div>
        <div className="setting-ctl">
          <label className="switch"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span className="track" /></label>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dir-connector">Connector (reaches the directory)</label>
        <select id="dir-connector" className="select" value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
          {connectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dir-host">Host</label>
        <input id="dir-host" type="text" className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="dc01.corp.example.com" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dir-port">Port</label>
        <input id="dir-port" type="number" className="input" value={port} onChange={(e) => setPort(e.target.value)} placeholder="389" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dir-security">Security</label>
        <select id="dir-security" className="select" value={security} onChange={(e) => setSecurity(e.target.value as Security)}>
          <option value="STARTTLS">STARTTLS (389 → TLS)</option>
          <option value="LDAPS">LDAPS (636, TLS)</option>
          <option value="PLAIN">Plain (no TLS — lab only)</option>
        </select>
      </div>
      <div className="field">
        <label className="form-check">
          <input type="checkbox" checked={insecureSkipVerify} onChange={(e) => setInsecureSkipVerify(e.target.checked)} />
          <span>Skip TLS certificate verification (self-signed AD cert)</span>
        </label>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dir-basedn">Base DN</label>
        <input id="dir-basedn" type="text" className="input" value={baseDN} onChange={(e) => setBaseDN(e.target.value)} placeholder="DC=corp,DC=example,DC=com" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dir-binddn">Bind DN (service account)</label>
        <input id="dir-binddn" type="text" className="input" value={bindDN} onChange={(e) => setBindDN(e.target.value)} placeholder="CN=captivo,OU=Service,DC=corp,DC=example,DC=com" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dir-bindpw">Bind password</label>
        <input id="dir-bindpw" type="password" className="input" value={bindPassword} onChange={(e) => setBindPassword(e.target.value)} placeholder={initial.hasBindPassword ? "•••••••• (unchanged)" : ""} autoComplete="new-password" />
      </div>

      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>}

      <div className="row-actions">
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={test} disabled={busy}>Test connection</button>
      </div>
    </form>
  );
}
