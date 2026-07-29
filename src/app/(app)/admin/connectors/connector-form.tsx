"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "name_required":
      return "A connector name is required.";
    case "forbidden":
      return "Admin privileges are required for this action.";
    default:
      return "Couldn't create the connector, please try again.";
  }
}

export function ConnectorForm() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; installCommand: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPairing(null);
    setCopied(false);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.code) {
        setError(errorMessage(result?.error));
        return;
      }
      setPairing({ code: result.code, installCommand: result.installCommand });
      setName("");
    } catch {
      setError("Couldn't create the connector, please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.installCommand);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="field-label" htmlFor="connector-name">
            Connector name
          </label>
          <input
            id="connector-name"
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Customer HQ"
          />
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Creating…" : "Add connector"}
        </button>
      </form>

      {pairing && (
        <div role="status" className="notice">
          <p>
            This pairing code is shown only once — it&apos;s embedded in the command below. Run it on a
            host inside the customer&apos;s network to enroll the connector.
          </p>
          <code className="code secret">{pairing.installCommand}</code>
          <button type="button" className="btn sm ghost" onClick={handleCopy}>
            {copied ? "Copied" : "Copy command"}
          </button>
          <p>
            Replace <code>DATAPLANE_URL</code> and <code>UPSTREAMS</code> with your data-plane&apos;s
            public address and the internal host(s) this connector should reach.
          </p>
        </div>
      )}
    </div>
  );
}
