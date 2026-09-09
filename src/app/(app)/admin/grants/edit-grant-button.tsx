"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTimezone } from "@/app/(app)/_shell/timezone-context";
import { TimezoneHint } from "@/app/(app)/_shell/effective-timezone";
import { formatDatetimeLocal, parseDatetimeLocal } from "@/lib/time/datetime-local";

// ISO → value for <input type="datetime-local"> in the display timezone (or the
// browser's when none is configured) — the same zone the grant list shows.
function toLocalInput(iso: string | null, tz: string | null): string {
  if (!iso) return "";
  return formatDatetimeLocal(new Date(iso), tz);
}

function saveError(code: string | undefined): string {
  switch (code) {
    case "ends_at_in_past": return "The end date must be in the future.";
    case "ends_at_before_start": return "The end date must be after the start date.";
    case "invalid_ends_at": return "Enter a valid end date.";
    case "grant_requires_end": return "Policy requires an end date — permanent grants aren't allowed here.";
    case "grant_exceeds_max": return "This grant is longer than the maximum duration allowed by policy.";
    case "note_too_long": return "The note is too long (max 500 characters).";
    case "invalid_note": return "The note must be text.";
    case "not_active": return "This grant is no longer active and can't be edited.";
    case "nothing_to_update": return "Nothing to save.";
    case "forbidden": return "Admin privileges are required.";
    default: return "Couldn't save, please try again.";
  }
}

export function EditGrantButton({ id, endsAt, note }: { id: string; endsAt: string | null; note: string | null }) {
  const tz = useTimezone();
  const [open, setOpen] = useState(false);
  // Filled when the editor opens (client-side) so the browser-zone fallback never
  // runs during SSR.
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [noteValue, setNoteValue] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const payload: { endsAt?: string; note: string } = { note: noteValue };
      if (endsAtLocal) {
        const d = parseDatetimeLocal(endsAtLocal, tz);
        if (!d) {
          setError("Enter a valid end date.");
          setBusy(false);
          return;
        }
        payload.endsAt = d.toISOString();
      }
      const res = await fetch(`/api/admin/grants/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError(saveError(result?.error));
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't save, please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn sm" onClick={() => { setEndsAtLocal(toLocalInput(endsAt, tz)); setOpen(true); }}>
        Edit
      </button>
    );
  }

  return (
    <div>
      <div className="field">
        <label className="field-label" htmlFor={`edit-ends-${id}`}>End date<TimezoneHint /></label>
        <input
          id={`edit-ends-${id}`}
          type="datetime-local"
          className="input"
          value={endsAtLocal}
          onChange={(e) => setEndsAtLocal(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`edit-note-${id}`}>Note</label>
        <input
          id={`edit-note-${id}`}
          type="text"
          className="input"
          value={noteValue}
          maxLength={500}
          onChange={(e) => setNoteValue(e.target.value)}
        />
      </div>
      <div className="row-actions">
        <button type="button" className="btn sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}
