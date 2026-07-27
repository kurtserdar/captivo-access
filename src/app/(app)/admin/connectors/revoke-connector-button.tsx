"use client";

import { useState } from "react";

export function RevokeConnectorButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm("Are you sure you want to revoke this connector? It will lose access immediately.")) {
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("Couldn't revoke the connector, please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't revoke the connector, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="link-button" onClick={handleClick} disabled={busy}>
        {busy ? "Revoking…" : "Revoke"}
      </button>
      {error && <p role="alert">{error}</p>}
    </span>
  );
}
