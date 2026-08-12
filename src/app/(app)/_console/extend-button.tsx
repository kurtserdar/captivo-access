"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXTEND_OPTIONS, nextEndsAt } from "@/lib/console/extend";

export function ExtendButton({ grantId, endsAt }: { grantId: string; endsAt: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function extend(hours: number) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endsAt: nextEndsAt(endsAt, hours, new Date()) }),
      });
      if (!res.ok) { setErr("Exceeds the maximum grant length"); setBusy(false); return; }
      router.refresh();
    } catch {
      setErr("Couldn't extend"); setBusy(false);
    }
  }

  return (
    <span className="sc-extend">
      {EXTEND_OPTIONS.map((o) => (
        <button key={o.label} type="button" className="btn sm" disabled={busy} onClick={() => extend(o.hours)}>{o.label}</button>
      ))}
      {err && <span className="sc-extend-err">{err}</span>}
    </span>
  );
}
