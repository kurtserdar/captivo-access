"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_name":
      return "Enter a tenant name.";
    case "invalid_slug":
      return "Enter a valid slug (lowercase letters, digits, and hyphens).";
    case "invalid_email":
      return "Enter a valid admin email address.";
    case "slug_taken":
      return "That slug is already in use.";
    default:
      return "Could not create the tenant, please try again.";
  }
}

export function CreateTenantForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; inviteUrl: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, adminEmail, adminName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorMessage(body?.error));
        return;
      }
      setResult({ slug: body.tenant.slug, inviteUrl: body.inviteUrl });
    } catch {
      setError(errorMessage(undefined));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <p className="notice success">
        Tenant <strong>{result.slug}</strong> created. Send the first admin this invite link:
        <br />
        <code>{result.inviteUrl}</code>
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label className="field-label">Tenant name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label">Slug</label>
        <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label">First admin email</label>
        <input
          className="input"
          type="email"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label className="field-label">First admin name (optional)</label>
        <input className="input" value={adminName} onChange={(e) => setAdminName(e.target.value)} maxLength={100} autoComplete="off" />
        <p className="cell-sub">Leave empty to let them enter it when they accept the invite.</p>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? "Creating…" : "Create tenant"}
      </button>
    </form>
  );
}
