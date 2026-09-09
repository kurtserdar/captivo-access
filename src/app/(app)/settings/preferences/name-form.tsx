"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DISPLAY_NAME_MAX } from "@/lib/auth/display-name";

export function NameForm({ initial, locked = false }: { initial: string; locked?: boolean }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error === "directory_managed" ? "Your name is managed by your organization's directory." : "Enter a name (up to 100 characters).");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't save, please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="field" style={{ maxWidth: 420 }} onSubmit={save}>
      <input className="input" value={name} maxLength={DISPLAY_NAME_MAX} disabled={locked} onChange={(e) => { setName(e.target.value); setSaved(false); }} required autoComplete="name" />
      {locked ? (
        <p className="cell-sub" style={{ marginTop: 8 }}>Managed by your organization&apos;s directory.</p>
      ) : (
        <button type="submit" className="btn primary" style={{ marginTop: 12 }} disabled={busy || !name.trim() || name.trim() === initial}>{busy ? "Saving…" : "Save"}</button>
      )}
      {saved && <span className="cell-sub" style={{ marginLeft: 10 }}>Saved.</span>}
      {error && <p className="notice error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
    </form>
  );
}
