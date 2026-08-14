"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function TerminateButton({ sessionId, grantId, vendorLabel, className }: { sessionId: string; grantId?: string | null; vendorLabel?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  async function handleClick() {
    const msg = grantId
      ? `End this session and revoke ${vendorLabel ?? "the vendor"}'s access to this resource? Their next request will be denied.`
      : "Terminate this session? The user will be disconnected immediately.";
    if (!(await confirm(msg, { danger: true, confirmLabel: grantId ? "Terminate & revoke" : "Terminate" }))) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/live/${sessionId}/terminate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(grantId ? { grantId } : {}),
      });
    } catch {
      /* refresh will reflect reality */
    }
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
