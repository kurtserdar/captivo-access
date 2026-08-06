"use client";

import { useState } from "react";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function RemoveRecoveryButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function handleClick() {
    if (!(await confirm("Are you sure you want to remove the recovery code?", { danger: true }))) return;

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
      {dialog}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn danger" onClick={handleClick} disabled={busy}>
        {busy ? "Removing…" : "Remove recovery"}
      </button>
    </div>
  );
}
