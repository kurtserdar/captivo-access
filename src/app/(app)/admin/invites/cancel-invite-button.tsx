"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function CancelInviteButton({ id, email }: { id: string; email: string }) {
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    if (!(await confirm(`Cancel the invite for ${email}? The link will stop working.`, { danger: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setError("Couldn't cancel — this invite may have already been used.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {dialog}
      <button type="button" className="btn sm danger" onClick={onClick} disabled={busy}>
        {busy ? "Cancelling…" : "Cancel"}
      </button>
      {error && <p className="notice error" role="alert">{error}</p>}
    </>
  );
}
