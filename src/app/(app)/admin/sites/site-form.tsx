"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "connector_name_upstream_required":
      return "Connector, name, and upstream name are required.";
    case "invalid_hostname":
      return "A public hostname is required.";
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
  const [upstreamName, setUpstreamName] = useState("");
  const [description, setDescription] = useState("");
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
          upstreamName,
          description: description.trim() || undefined,
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
      <label>
        Connector
        <select value={connectorId} onChange={(e) => setConnectorId(e.target.value)} required>
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Site name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. Internal wiki"
        />
      </label>
      <label>
        Public hostname
        <input
          type="text"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          required
          placeholder="wiki.access.example.com"
        />
      </label>
      <label>
        Upstream name
        <input
          type="text"
          value={upstreamName}
          onChange={(e) => setUpstreamName(e.target.value)}
          required
          placeholder="must match a name in the connector's UPSTREAMS env"
        />
      </label>
      <label>
        Description (optional)
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add site"}
      </button>
    </form>
  );
}
