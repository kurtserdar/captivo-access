"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "unauthorized":
      return "Oturumunuz sona ermiş, lütfen tekrar giriş yapın.";
    case "invalid_body":
      return "Etiket gerekli.";
    case "challenge_expired":
      return "Oturum süresi doldu, lütfen tekrar deneyin.";
    case "verification_failed":
      return "Passkey doğrulaması başarısız oldu.";
    default:
      return "Passkey eklenemedi, lütfen tekrar deneyin.";
  }
}

export function AddPasskeyButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const label = window.prompt("Bu passkey için bir etiket girin (ör. \"İş dizüstü\"):");
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
      setError("Passkey eklenemedi, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={handleClick} disabled={busy}>
        {busy ? "Ekleniyor…" : "Yeni passkey ekle"}
      </button>
    </div>
  );
}
