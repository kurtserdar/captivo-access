"use client";
import { useState } from "react";
import { useConfirm } from "@/app/(app)/_shell/confirm-dialog";

const MESSAGES: Record<string, string> = {
  has_sites: "This connector still has sites — move or remove them under Sites first.",
  not_revoked: "Revoke the connector before deleting it.",
};

export function DeleteConnectorButton({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function handleClick() {
    if (!(await confirm(`Permanently delete connector "${name}"? This can't be undone.`, { danger: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors/${encodeURIComponent(id)}/delete`, { method: "POST" });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !result?.ok) {
        setError((result?.error && MESSAGES[result.error]) || "Couldn't delete the connector, please try again.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't delete the connector, please try again.");
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
