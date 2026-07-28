"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

const GENERIC_ERROR = "No passkey found or verification failed.";

export function LoginForm({ returnTo = "/" }: { returnTo?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const optionsRes = await fetch("/api/auth/authentication/options", { method: "POST" });
      const options = await optionsRes.json().catch(() => ({}));
      if (!optionsRes.ok) {
        setError(GENERIC_ERROR);
        return;
      }

      const response = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/authentication/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const result = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !result?.ok) {
        setError(GENERIC_ERROR);
        return;
      }

      window.location.href = returnTo;
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <p role="alert">
          {error} <a href="/recover">Recover your account</a>
        </p>
      )}
      <button type="button" onClick={handleClick} disabled={busy}>
        {busy ? "Verifying…" : "Sign in with passkey"}
      </button>
    </div>
  );
}
