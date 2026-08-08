"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "cannot_delete_self":
      return "You can't delete yourself.";
    case "cannot_delete_admin":
      return "Admins can't be deleted — change their role first.";
    case "forbidden":
      return "Admin privileges are required for this action.";
    default:
      return "Couldn't delete the user, please try again.";
  }
}

export function DeleteUserButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const ok = await confirm(
      `Delete ${name}? This permanently removes their account, passkeys, and access. Their audit history is kept.`,
      { danger: true, confirmLabel: "Delete user" },
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errorMessage(body?.error));
        return;
      }
      router.refresh();
    } catch {
      setError(errorMessage(undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <button type="button" className="btn sm danger" onClick={handleClick} disabled={busy}>
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && (
        <span className="error" style={{ marginLeft: ".4rem" }}>
          {error}
        </span>
      )}
    </>
  );
}
