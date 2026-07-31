"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DecisionButtons({ grantId }: { grantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) { setError("Action failed."); return; }
      router.refresh();
    } catch {
      setError("Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-actions">
      <button className="btn sm primary" disabled={busy} onClick={() => decide("approve")}>Approve</button>
      <button className="btn sm danger" disabled={busy} onClick={() => decide("deny")}>Deny</button>
      {error && <span className="notice error">{error}</span>}
    </div>
  );
}
