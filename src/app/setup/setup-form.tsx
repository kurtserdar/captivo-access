"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "already_setup":
      return "This system has already been set up. Please sign in.";
    case "email_taken":
      return "This email address is already in use.";
    case "challenge_expired":
      return "The session timed out, please try again.";
    case "verification_failed":
      return "Passkey verification failed.";
    case "invalid_body":
    case "email_and_name_required":
      return "Name and email are required.";
    default:
      return "Something went wrong, please try again.";
  }
}

export function SetupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const optionsRes = await fetch("/api/auth/registration/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "setup", email, name }),
      });
      const options = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        setError(errorMessage(options?.error));
        return;
      }

      const response = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/registration/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "setup", response, email, name }),
      });
      const result = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Something went wrong, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="setup-name">
          Full name
        </label>
        <input
          id="setup-name"
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="setup-email">
          Email
        </label>
        <input
          id="setup-email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Creating…" : "Create account with passkey"}
      </button>
    </form>
  );
}
