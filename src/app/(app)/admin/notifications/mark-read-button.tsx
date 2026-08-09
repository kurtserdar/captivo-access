"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/notifications/read", { method: "POST" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("Couldn't mark notifications as read, please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't mark notifications as read, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="btn sm" onClick={handleClick} disabled={busy}>
        {busy ? "Marking…" : "Mark all as read"}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </span>
  );
}
