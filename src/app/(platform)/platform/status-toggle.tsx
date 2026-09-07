"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StatusToggle({ id, status }: { id: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/tenants/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn sm" disabled={busy} onClick={toggle}>
      {status === "ACTIVE" ? "Suspend" : "Activate"}
    </button>
  );
}
