"use client";

import { useState } from "react";

export function RemoveRecoveryButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm("Are you sure you want to remove the recovery code?")) return;

    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recovery", { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("Couldn't remove recovery, please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't remove recovery, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="link-button" onClick={handleClick} disabled={busy}>
        {busy ? "Removing…" : "Remove recovery"}
      </button>
    </div>
  );
}
