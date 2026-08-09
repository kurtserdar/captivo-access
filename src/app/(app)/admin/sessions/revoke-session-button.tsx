"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function RevokeSessionButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function handleClick() {
  const router = useRouter();
    if (!(await confirm("Are you sure you want to revoke this session?", { danger: true }))) return;

    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("Couldn't revoke the session, please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't revoke the session, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <span>
        <button type="button" className="btn sm danger" onClick={handleClick} disabled={busy}>
          {busy ? "Revoking…" : "Revoke"}
        </button>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </span>
    </>
  );
}
