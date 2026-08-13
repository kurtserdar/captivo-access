"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function DeletePairingButton({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const router = useRouter();

  async function handleClick() {
    if (!(await confirm(`Delete the pending pairing for "${name}"? Its install command will stop working.`, { danger: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors/pairings/${encodeURIComponent(id)}/delete`, { method: "POST" });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !result?.ok) {
        setError("Couldn't delete the pairing, please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't delete the pairing, please try again.");
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
