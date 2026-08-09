"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function DeleteRecordingButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function handleClick() {
  const router = useRouter();
    if (!(await confirm("Delete this recording? This can't be undone.", { danger: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/recordings/${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !result?.ok) {
        setError("Couldn't delete the recording, please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't delete the recording, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <span>
        <button type="button" className="btn sm danger" onClick={handleClick} disabled={busy}>
          {busy ? "Deleting…" : "Delete"}
        </button>
        {error && <p className="notice error" role="alert">{error}</p>}
      </span>
    </>
  );
}
