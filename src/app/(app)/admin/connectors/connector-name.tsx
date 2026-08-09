"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConnectorName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/connectors/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("Couldn't rename, please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't rename, please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="row-actions">
        <span>{name}</span>
        <button type="button" className="btn sm" onClick={() => setEditing(true)}>Rename</button>
      </span>
    );
  }

  return (
    <span>
      <span className="row-actions">
        <input
          type="text"
          className="input"
          value={value}
          maxLength={100}
          aria-label="Connector name"
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="btn sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn sm" onClick={() => { setEditing(false); setValue(name); setError(null); }} disabled={busy}>
          Cancel
        </button>
      </span>
      {error && <p className="notice error" role="alert">{error}</p>}
    </span>
  );
}
