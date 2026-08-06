"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function WithdrawRequestButton({ id }: { id: string }) {
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    if (!(await confirm("Withdraw this access request?", { danger: true }))) return;
    setBusy(true);
    try {
      await fetch(`/api/access/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {dialog}
      <button type="button" className="btn sm danger" onClick={onClick} disabled={busy}>
        {busy ? "Withdrawing…" : "Withdraw"}
      </button>
    </>
  );
}
