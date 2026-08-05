"use client";
import { useState } from "react";

export function ResendInviteButton({ id, email }: { id: string; email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/invites/${encodeURIComponent(id)}/resend`, { method: "POST" });
      const r = (await res.json().catch(() => ({}))) as { link?: string; emailed?: boolean; error?: string };
      if (!res.ok || !r.link) {
        setError("Couldn't resend the invite, please try again.");
        return;
      }
      setResult({ link: r.link, emailed: !!r.emailed });
    } catch {
      setError("Couldn't resend the invite, please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.link); setCopied(true); } catch { setCopied(false); }
  }

  if (result) {
    return (
      <div className="notice">
        <p>New invite link (shown once):</p>
        <code className="code secret">{result.link}</code>
        <button type="button" className="btn sm ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <p className="hint">{result.emailed ? `Emailed to ${email}.` : "Couldn't email it — copy the link and send it manually."}</p>
      </div>
    );
  }

  return (
    <span>
      <button type="button" className="btn sm" onClick={handleClick} disabled={busy}>
        {busy ? "Resending…" : "Resend"}
      </button>
      {error && <p className="notice error" role="alert">{error}</p>}
    </span>
  );
}
