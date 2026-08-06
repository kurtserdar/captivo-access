"use client";
import { useState } from "react";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

export function DeleteSiteButton({ id, name, grantCount }: { id: string; name: string; grantCount: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function handleClick() {
    const grants = grantCount === 1 ? "1 access grant" : `${grantCount} access grants`;
    if (!(await confirm(`Delete site "${name}"? This also removes ${grants} and can't be undone.`, { danger: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sites/${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !result?.ok) {
        setError("Couldn't delete the site, please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't delete the site, please try again.");
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
