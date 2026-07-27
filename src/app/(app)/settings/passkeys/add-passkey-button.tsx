"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "unauthorized":
      return "Your session has expired, please sign in again.";
    case "invalid_body":
      return "A label is required.";
    case "challenge_expired":
      return "The session timed out, please try again.";
    case "verification_failed":
      return "Passkey verification failed.";
    default:
      return "Couldn't add the passkey, please try again.";
  }
}

export function AddPasskeyButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const label = window.prompt("Enter a label for this passkey (e.g. \"Work laptop\"):");
    if (!label || !label.trim()) return;

    setError(null);
    setBusy(true);
    try {
      const optionsRes = await fetch("/api/auth/registration/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "add" }),
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
        body: JSON.stringify({ mode: "add", response, label: label.trim() }),
      });
      const result = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }

      window.location.reload();
    } catch {
      setError("Couldn't add the passkey, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={handleClick} disabled={busy}>
        {busy ? "Adding…" : "Add a new passkey"}
      </button>
    </div>
  );
}
