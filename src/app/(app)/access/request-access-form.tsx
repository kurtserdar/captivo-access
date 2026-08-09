"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScheduleBuilder } from "./schedule-builder";
import type { Schedule } from "@/lib/access/schedule";

type Site = { id: string; name: string };

export function RequestAccessForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/access/sites")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { sites: Site[] }) => setSites(d.sites))
      .catch(() => setError("Could not load the list of apps."));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId,
          note,
          startsAt: startsAt || undefined,
          endsAt: endsAt || undefined,
          schedule: schedule ?? undefined,
        }),
      });
      if (res.status === 409) { setError("You already have a pending request for this app."); return; }
      if (!res.ok) { setError("Could not submit the request. Check the fields and try again."); return; }
      setSiteId(""); setStartsAt(""); setEndsAt(""); setNote("");
      router.refresh();
      if (onDone) onDone();
      else setDone(true);
    } catch {
      setError("Could not submit the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={onDone ? undefined : "card"} onSubmit={submit}>
      {!onDone && <div className="card-head"><h2>Request access</h2></div>}
      {done && <p className="notice success">Access requested — waiting for an admin to approve.</p>}
      {error && <p className="notice error">{error}</p>}
      <div className="field">
        <label className="field-label" htmlFor="req-site">App</label>
        <select id="req-site" className="select" value={siteId} required onChange={(e) => setSiteId(e.target.value)}>
          <option value="" disabled>Select an app…</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="req-start">From (optional)</label>
        <input id="req-start" className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="req-end">Until (optional)</label>
        <input id="req-end" className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="req-note">Justification</label>
        <textarea id="req-note" className="textarea" required value={note} placeholder="Explain why you need access to this app" onChange={(e) => setNote(e.target.value)} />
      </div>
      <ScheduleBuilder onChange={setSchedule} />
      <button className="btn primary" type="submit" disabled={busy || !siteId || !note.trim()}>
        {busy ? "Submitting…" : "Request access"}
      </button>
    </form>
  );
}
