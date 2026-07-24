"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "already_setup":
      return "Bu sistem zaten kuruldu. Lütfen giriş yapın.";
    case "email_taken":
      return "Bu e-posta adresi zaten kullanımda.";
    case "challenge_expired":
      return "Oturum süresi doldu, lütfen tekrar deneyin.";
    case "verification_failed":
      return "Passkey doğrulaması başarısız oldu.";
    case "invalid_body":
    case "email_and_name_required":
      return "Ad ve e-posta gerekli.";
    default:
      return "Bir hata oluştu, lütfen tekrar deneyin.";
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
      setError("Bir hata oluştu, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Ad Soyad
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
      </label>
      <label>
        E-posta
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Oluşturuluyor…" : "Passkey ile hesabı oluştur"}
      </button>
    </form>
  );
}
