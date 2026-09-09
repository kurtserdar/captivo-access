"use client";

import { useState } from "react";

export function SignupForm({ domain }: { domain: string }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggest = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/signup/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, slug, email, adminName }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(b?.error === "slug_taken" ? "That address is taken or not allowed — try another." : b?.error === "invalid_email" ? "Enter a valid email." : b?.error === "rate_limited" ? "Too many attempts — try again in a minute." : b?.error === "mail_failed" ? "We couldn't send the confirmation email right now. Try again later." : "Check the fields and try again.");
        return;
      }
      setDone(true);
    } finally { setBusy(false); }
  }

  if (done) return <p className="notice success">Check your inbox — we sent a confirmation link to <b>{email}</b>. It is valid for 30 minutes.</p>;
  return (
    <form onSubmit={submit}>
      <div className="field"><label className="field-label" htmlFor="su-name">Company / workspace name</label><input id="su-name" className="input" required maxLength={120} value={name} onChange={(e) => { setName(e.target.value); if (!slug || slug === suggest(name)) setSlug(suggest(e.target.value)); }} /></div>
      <div className="field"><label className="field-label" htmlFor="su-slug">Workspace address</label><div className="row-actions"><input id="su-slug" className="input" required pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?" maxLength={63} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /><span className="cell-sub">.{domain}</span></div></div>
      <div className="field"><label className="field-label" htmlFor="su-admin">Your name</label><input id="su-admin" className="input" required maxLength={100} value={adminName} onChange={(e) => setAdminName(e.target.value)} autoComplete="name" /></div>
      <div className="field"><label className="field-label" htmlFor="su-email">Work email</label><input id="su-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy || !name || !slug || !email || !adminName}>{busy ? "Sending…" : "Send confirmation email"}</button>
    </form>
  );
}
