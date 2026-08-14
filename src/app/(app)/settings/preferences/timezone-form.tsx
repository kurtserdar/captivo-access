"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TimezoneSelect } from "@/app/(app)/_shell/timezone-select";

export function TimezoneForm({ initial }: { initial: string }) {
  const [tz, setTz] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/timezone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: tz || undefined }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="field" style={{ maxWidth: 420 }}>
      <TimezoneSelect value={tz} onChange={(v) => { setTz(v); setSaved(false); }} inheritLabel="Use the organization default" />
      <button type="button" className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      {saved && <span className="cell-sub" style={{ marginLeft: 10 }}>Saved.</span>}
    </div>
  );
}
