"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_body":
    case "name_email_role_required":
      return "Name, email, and role are required.";
    case "forbidden":
      return "Admin privileges are required for this action.";
    default:
      return "Couldn't create the invite, please try again.";
  }
}

export function InviteForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VENDOR" | "ADMIN">("VENDOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLink(null);
    setCopied(false);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.link) {
        setError(errorMessage(result?.error));
        return;
      }
      setLink(result.link);
      setName("");
      setEmail("");
      setRole("VENDOR");
    } catch {
      setError("Couldn't create the invite, please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="field-label" htmlFor="invite-name">
            Full name
          </label>
          <input
            id="invite-name"
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="invite-email">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="invite-role">
            Role
          </label>
          <select
            id="invite-role"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as "VENDOR" | "ADMIN")}
          >
            <option value="VENDOR">Vendor</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Creating…" : "Create invite"}
        </button>
      </form>

      {link && (
        <div role="status" className="notice">
          <p>This link is shown only once. Don&apos;t leave this page without saving it.</p>
          <code className="code secret">{link}</code>
          <button type="button" className="btn sm ghost" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
