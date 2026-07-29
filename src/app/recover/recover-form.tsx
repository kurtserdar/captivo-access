"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

// A SINGLE generic error message for step 1 (email+TOTP verification) —
// "user doesn't exist" / "TOTP not set up" / "wrong code" are never
// distinguished (to avoid an enumeration leak). Step 2 (new passkey
// registration) errors fall into the same message; gives an attacker no
// extra information.
const GENERIC_ERROR =
  "Invalid verification code or account can't be recovered — ask your admin for a new invitation.";

export function RecoverForm() {
  const [email, setEmail] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const recoverRes = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, totp }),
      });
      const recoverResult = await recoverRes.json().catch(() => ({}));
      if (!recoverRes.ok || !recoverResult?.ok) {
        setError(GENERIC_ERROR);
        return;
      }

      // Step 2: verification succeeded — proceed straight to new passkey registration.
      const optionsRes = await fetch("/api/auth/registration/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "recover" }),
      });
      const options = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        setError(GENERIC_ERROR);
        return;
      }

      const response = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/registration/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "recover", response }),
      });
      const verifyResult = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !verifyResult?.ok) {
        setError(GENERIC_ERROR);
        return;
      }

      window.location.href = "/";
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="recover-email">
          Email
        </label>
        <input
          id="recover-email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="recover-totp">
          Verification code
        </label>
        <input
          id="recover-totp"
          type="text"
          className="input"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          required
          autoComplete="one-time-code"
        />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Verifying…" : "Create new passkey"}
      </button>
    </form>
  );
}
