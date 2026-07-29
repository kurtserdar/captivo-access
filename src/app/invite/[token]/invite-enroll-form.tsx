"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "invite_invalid":
      return "This invite is no longer valid. Ask your admin for a new invitation.";
    case "challenge_expired":
      return "The session timed out, please try again.";
    case "verification_failed":
      return "Passkey verification failed.";
    case "invalid_body":
      return "Invalid request.";
    default:
      return "Something went wrong, please try again.";
  }
}

export function InviteEnrollForm({ token }: { token: string }) {
  const [passkeyLabel, setPasskeyLabel] = useState("Primary passkey");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const optionsRes = await fetch("/api/auth/registration/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "invite", inviteToken: token }),
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
        body: JSON.stringify({ mode: "invite", inviteToken: token, response, label: passkeyLabel }),
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
    <div>
      <div className="field">
        <label className="field-label" htmlFor="invite-passkey-label">
          Passkey name
        </label>
        <input
          id="invite-passkey-label"
          type="text"
          className="input"
          value={passkeyLabel}
          onChange={(e) => setPasskeyLabel(e.target.value)}
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn primary" onClick={handleClick} disabled={busy}>
        {busy ? "Registering…" : "Register with passkey"}
      </button>
    </div>
  );
}
