"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkOneReadButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      await fetch(`/api/admin/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="btn sm ghost" onClick={onClick} disabled={busy}>
      {busy ? "…" : "Mark read"}
    </button>
  );
}
