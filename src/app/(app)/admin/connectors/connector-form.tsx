"use client";

import { useState } from "react";
import { CommandBlock } from "@/app/(app)/_shell/command-block";
import { formatDockerRun } from "@/lib/format/docker-command";

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
  const [gateway, setGateway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; installCommand: string; managerUrlIsLocal: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPairing(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, gateway }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.code) {
        setError(errorMessage(result?.error));
        return;
      }
      setPairing({
        code: result.code,
        installCommand: result.installCommand,
        managerUrlIsLocal: Boolean(result.managerUrlIsLocal),
      });
      setName("");
    } catch {
      setError("Couldn't create the connector, please try again.");
    } finally {
      setBusy(false);
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
        <div className="field">
          <label className="form-check">
            <input type="checkbox" checked={gateway} onChange={(e) => setGateway(e.target.checked)} />
            <span>This host will also run the Guacamole gateway</span>
          </label>
          <p className="cell-sub">
            Bakes <code>--network captivo-gateway</code> into the connector command so it can reach Guacamole
            — no separate &quot;Enable gateway mode&quot; step. See <code>deploy/gateway/README.md</code>.
          </p>
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
          <CommandBlock
            command={pairing.installCommand}
            display={formatDockerRun(pairing.installCommand)}
            title="connector-install"
          />
          {pairing.managerUrlIsLocal && (
            <p className="notice error">
              <code>MANAGER_URL</code> points at <code>localhost</code> (you&apos;re viewing this over
              a tunnel). The connector runs on another machine and can&apos;t reach it there — replace
              it with the manager&apos;s real address (set <code>MANAGER_PUBLIC_URL</code> in the
              server&apos;s <code>.env</code>).
            </p>
          )}
          <p>
            This connector needs no per-app configuration. Define each internal app as a{" "}
            <b>Site</b> (with its internal address) in the console — the connector reads that address
            from the Manager and dials it directly.
          </p>
          <p>
            To cap what this connector may reach, optionally set <code>ALLOWED_TARGETS</code> (e.g.{" "}
            <code>10.0.5.0/24</code>) on the container. Unset means it dials whatever the Manager
            routes to it.
          </p>
          <p>
            <code>MANAGER_URL</code> and <code>DATAPLANE_URL</code> are filled from your server config
            (<code>MANAGER_PUBLIC_URL</code> / <code>CONNECTOR_TUNNEL_URL</code>). If{" "}
            <code>DATAPLANE_URL</code> still shows a <code>&lt;your-access-domain&gt;</code>{" "}
            placeholder, set <code>CONNECTOR_TUNNEL_URL</code> (e.g.{" "}
            <code>wss://connect.your-domain</code>) in the server&apos;s <code>.env</code>. Always use{" "}
            <code>wss://</code> — a plain <code>ws://</code> tunnel is unencrypted.
          </p>
        </div>
      )}
    </div>
  );
}
