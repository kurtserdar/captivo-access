"use client";

import { useState } from "react";
import { ScheduleBuilder } from "@/app/(app)/access/schedule-builder";
import type { Schedule } from "@/lib/access/schedule";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { Role } from "@/generated/prisma/enums";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "user_site_required":
      return "A user and a site are required.";
    case "invalid_date":
      return "Start and end must be valid dates.";
    case "invalid_user":
      return "Select a valid user.";
    case "invalid_site":
      return "Select a valid site.";
    case "forbidden":
      return "Admin privileges are required for this action.";
    default:
      return "Couldn't create the grant, please try again.";
  }
}

export function GrantForm({
  users,
  sites,
}: {
  users: { id: string; name: string; email: string; role: Role }[];
  sites: { id: string; name: string }[];
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          siteId,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          note: note.trim() || undefined,
          schedule: schedule ?? undefined,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.id) {
        setError(errorMessage(result?.error));
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't create the grant, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="grant-user">
          User
        </label>
        <select id="grant-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)} required>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email}) — {ROLE_LABELS[u.role] ?? u.role}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="grant-site">
          Site
        </label>
        <select id="grant-site" className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="grant-starts-at">
          Start (optional)
        </label>
        <input
          id="grant-starts-at"
          type="datetime-local"
          className="input"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="grant-ends-at">
          End (optional — leave empty for permanent access)
        </label>
        <input
          id="grant-ends-at"
          type="datetime-local"
          className="input"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="grant-note">
          Note (optional)
        </label>
        <input
          id="grant-note"
          type="text"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. reason for access"
        />
      </div>
      <ScheduleBuilder onChange={setSchedule} />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy || !userId || !siteId}>
        {busy ? "Granting…" : "Grant access"}
      </button>
    </form>
  );
}
