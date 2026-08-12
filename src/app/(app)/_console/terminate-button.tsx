"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function TerminateButton({ sessionId, className }: { sessionId: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  async function handleClick() {
    if (!(await confirm("Terminate this session? The user will be disconnected immediately.", { danger: true, confirmLabel: "Terminate" }))) return;
    setBusy(true);
    try { await fetch(`/api/admin/live/${sessionId}/terminate`, { method: "POST" }); }
    catch { /* refresh will reflect reality */ }
    router.refresh();
  }

  return (
    <>
      {dialog}
      <button type="button" className={className ?? "btn sm danger"} onClick={handleClick} disabled={busy}>
        {busy ? "Terminating…" : "Terminate"}
      </button>
    </>
  );
}
