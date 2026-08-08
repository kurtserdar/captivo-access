"use client";
import { useState } from "react";

export function ToggleGatewayButton({ id, gatewayHost }: { id: string; gatewayHost: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = gatewayHost ? "Disable gateway mode" : "Enable gateway mode";

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayHost: !gatewayHost }),
      });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !result?.ok) {
        setError("Action failed, please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Action failed, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn sm" onClick={handleClick} disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
      {error && <p className="notice error" role="alert">{error}</p>}
    </>
  );
}
