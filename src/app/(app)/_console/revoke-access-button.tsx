"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function RevokeAccessButton({ grantId, label, className }: { grantId: string; label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  async function handleClick() {
    if (!(await confirm(`Revoke ${label}'s access to this resource? Their next request will be denied.`, { danger: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/grants?id=${encodeURIComponent(grantId)}`, { method: "DELETE" });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !result?.ok) {
        setError("Couldn't revoke access, please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't revoke access, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <span className="sc-revoke">
        <button type="button" className={className ?? "btn sm danger"} onClick={handleClick} disabled={busy}>
          {busy ? "Revoking…" : "Revoke access"}
        </button>
        {error && <p className="notice error" role="alert">{error}</p>}
      </span>
    </>
  );
}
