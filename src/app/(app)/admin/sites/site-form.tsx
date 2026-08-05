"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "connector_name_upstream_required":
      return "Connector, name, and internal address are required.";
    case "invalid_hostname":
      return "A public hostname is required.";
    case "invalid_upstream_url":
      return "The internal address must be a valid http:// or https:// URL.";
    case "connector_not_found":
      return "Select a valid connector.";
    case "forbidden":
      return "Admin privileges are required for this action.";
    default:
      return "Couldn't create the site, please try again.";
  }
}

export function SiteForm({ connectors }: { connectors: { id: string; name: string }[] }) {
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? "");
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [description, setDescription] = useState("");
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId,
          name,
          hostname,
          upstreamUrl,
          description: description.trim() || undefined,
          insecureSkipVerify,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.id) {
        setError(errorMessage(result?.error));
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't create the site, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="site-connector">
          Connector
        </label>
        <select
          id="site-connector"
          className="select"
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          required
        >
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-name">
          Site name
        </label>
        <input
          id="site-name"
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. Internal wiki"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-hostname">
          Public hostname
        </label>
        <input
          id="site-hostname"
          type="text"
          className="input"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          required
          placeholder="wiki.access.example.com"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-upstream">
          Internal address
        </label>
        <input
          id="site-upstream"
          type="text"
          className="input"
          value={upstreamUrl}
          onChange={(e) => setUpstreamUrl(e.target.value)}
          required
          placeholder="http://10.0.5.20:8080"
        />
        <p className="hint">
          The real internal address this connector should reach (e.g. <code>http://10.0.5.20:8080</code>).
          It&apos;s stored on your Manager and sent to the connector over the tunnel; the connector dials it
          inside your network. To cap what a connector may reach, set <code>ALLOWED_TARGETS</code> on it.
        </p>
      </div>
      <div className="field">
        <label className="field-label">
          <input
            type="checkbox"
            checked={insecureSkipVerify}
            onChange={(e) => setInsecureSkipVerify(e.target.checked)}
          />{" "}
          Allow self-signed certificate (skip TLS verification)
        </label>
        <span className="hint">
          Only for internal devices you trust — the certificate on the connector→app leg won&apos;t be verified.
        </span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="site-description">
          Description (optional)
        </label>
        <input
          id="site-description"
          type="text"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Adding…" : "Add site"}
      </button>
    </form>
  );
}
