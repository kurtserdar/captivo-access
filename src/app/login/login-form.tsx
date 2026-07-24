"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

const GENERIC_ERROR = "Passkey bulunamadı veya doğrulanamadı.";

export function LoginForm() {
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

      window.location.href = "/";
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
          {error} <a href="/recover">Hesabınızı kurtarın</a>
        </p>
      )}
      <button type="button" onClick={handleClick} disabled={busy}>
        {busy ? "Doğrulanıyor…" : "Passkey ile giriş"}
      </button>
    </div>
  );
}
