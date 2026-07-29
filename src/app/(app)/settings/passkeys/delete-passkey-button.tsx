"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "last_passkey":
      return "You can't delete your last passkey.";
    case "not_found":
      return "Passkey not found.";
    case "unauthorized":
      return "Your session has expired, please sign in again.";
    default:
      return "Couldn't delete the passkey, please try again.";
  }
}

export function DeletePasskeyButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm("Are you sure you want to delete this passkey?")) return;

    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/passkeys/${id}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't delete the passkey, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        className="btn sm danger"
        onClick={handleClick}
        disabled={busy || disabled}
        title={disabled ? "You can't delete your last passkey" : undefined}
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </span>
  );
}
