"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function WithdrawRequestButton({ id }: { id: string }) {
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    if (!(await confirm("Withdraw this access request?", { danger: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setError("Couldn't withdraw — this request may have already been decided.");
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
      {error && <p className="notice error" role="alert">{error}</p>}
    </>
  );
}
