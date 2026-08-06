"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, ASSIGNABLE_ROLES } from "@/lib/auth/roles";

export function RoleSelect({ userId, role, disabled }: { userId: string; role: string; disabled?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [busy, setBusy] = useState(false);
  async function onChange(next: string) {
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (res.ok) router.refresh();
      else setValue(role); // revert on failure
    } finally {
      setBusy(false);
    }
  }
  return (
    <select className="select" value={value} disabled={disabled || busy} onChange={(e) => onChange(e.target.value)}>
      {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
    </select>
  );
}
