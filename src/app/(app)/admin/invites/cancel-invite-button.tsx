"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function CancelInviteButton({ id, email }: { id: string; email: string }) {
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    if (!(await confirm(`Cancel the invite for ${email}? The link will stop working.`, { danger: true }))) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
      router.refresh();
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
    </>
  );
}
