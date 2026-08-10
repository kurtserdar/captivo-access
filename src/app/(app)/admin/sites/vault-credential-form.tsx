"use client";
import { useState } from "react";

export function VaultCredentialForm({ siteId, hasSecret }: { siteId: string; hasSecret: boolean }) {
  const [protocol, setProtocol] = useState("RDP");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3389");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [secretKind, setSecretKind] = useState("PASSWORD");
  const [isSet, setIsSet] = useState(hasSecret);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function save() {
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/admin/sites/${siteId}/vault`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocol, targetHost: host, targetPort: Number(port), username, secret, secretKind }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && body.ok) {
      setNotice({ kind: "ok", msg: "Saved. The vendor connects without ever seeing the password." });
      setSecret("");
      setIsSet(true);
    } else {
      setNotice({ kind: "err", msg: "Could not save — check the fields." });
    }
  }

  async function clear() {
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/admin/sites/${siteId}/vault`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setNotice({ kind: "ok", msg: "Credential cleared." });
      setIsSet(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <div className="card-head">
        <h2>Vault credential</h2>
        {isSet && <span className="pill ok">Set</span>}
      </div>
      <p className="cell-sub" style={{ marginBottom: "1rem" }}>
        Stored encrypted and injected into the session — the vendor never sees it and never logs into the gateway.
      </p>
      <div className="field">
        <label className="field-label">Protocol</label>
        <select className="select" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="RDP">RDP</option>
          <option value="SSH">SSH</option>
          <option value="VNC">VNC</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label">Target host</label>
        <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.5" />
      </div>
      <div className="field">
        <label className="field-label">Port</label>
        <input className="input" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">Username</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">Secret</label>
        <select className="select" value={secretKind} onChange={(e) => setSecretKind(e.target.value)}>
          <option value="PASSWORD">Password</option>
          <option value="KEY">Private key</option>
        </select>
        <textarea
          className="textarea"
          style={{ marginTop: ".4rem" }}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isSet ? "•••••••• (stored — type to replace)" : "Enter the target password or private key"}
        />
      </div>
      {notice && <p className={`notice ${notice.kind === "ok" ? "success" : "error"}`} role="alert">{notice.msg}</p>}
      <div className="row-actions" style={{ marginTop: "1rem" }}>
        <button className="btn primary" onClick={save} disabled={busy}>Save credential</button>
        {isSet && <button className="btn ghost" onClick={clear} disabled={busy}>Clear</button>}
      </div>
    </div>
  );
}
