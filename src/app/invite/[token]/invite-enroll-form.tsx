"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "invite_invalid":
      return "Bu davet artık geçerli değil. Yöneticinizden yeni bir davet isteyin.";
    case "challenge_expired":
      return "Oturum süresi doldu, lütfen tekrar deneyin.";
    case "verification_failed":
      return "Passkey doğrulaması başarısız oldu.";
    case "invalid_body":
      return "Geçersiz istek.";
    default:
      return "Bir hata oluştu, lütfen tekrar deneyin.";
  }
}

export function InviteEnrollForm({ token }: { token: string }) {
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
        body: JSON.stringify({ mode: "invite", inviteToken: token, response }),
      });
      const result = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Bir hata oluştu, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={handleClick} disabled={busy}>
        {busy ? "Kaydediliyor…" : "Passkey ile kayıt ol"}
      </button>
    </div>
  );
}
