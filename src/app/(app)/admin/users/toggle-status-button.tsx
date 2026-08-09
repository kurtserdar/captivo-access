"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "cannot_disable_self":
      return "You can't disable yourself.";
    case "forbidden":
      return "Admin privileges are required for this action.";
    case "not_found":
      return "User not found.";
    default:
      return "Action failed, please try again.";
  }
}

export function ToggleStatusButton({ userId, status }: { userId: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus = status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  const label = status === "ACTIVE" ? "Disable" : "Activate";

  async function handleClick() {
  const router = useRouter();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }
      router.refresh();
    } catch {
      setError("Action failed, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="btn sm" onClick={handleClick} disabled={busy}>
        {busy ? "Processing…" : label}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </span>
  );
}
