"use client";

import { useState } from "react";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  VENDOR: "Vendor",
};

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
  users: { id: string; name: string; email: string; role: string }[];
  sites: { id: string; name: string }[];
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
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
      <label>
        User
        <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email}) — {ROLE_LABEL[u.role] ?? u.role}
            </option>
          ))}
        </select>
      </label>
      <label>
        Site
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Start (optional)
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </label>
      <label>
        End (optional — leave empty for permanent access)
        <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </label>
      <label>
        Note (optional)
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. reason for access" />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy || !userId || !siteId}>
        {busy ? "Granting…" : "Grant access"}
      </button>
    </form>
  );
}
