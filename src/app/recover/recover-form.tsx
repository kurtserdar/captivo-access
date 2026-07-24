"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

// Adım 1 (e-posta+TOTP doğrulama) için TEK genel hata mesajı — "kullanıcı
// yok" / "TOTP kurulu değil" / "kod yanlış" ayrımı yapılmaz (numaralandırma
// sızıntısı olmasın diye). Adım 2 (yeni passkey kaydı) hataları da aynı
// mesaja düşer; saldırgana ek bilgi vermez.
const GENERIC_ERROR =
  "Doğrulama kodu geçersiz veya hesap kurtarılamıyor — yöneticinizden yeni davet isteyin.";

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

      // Adım 2: doğrulama başarılı — hemen yeni passkey kaydına geç.
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
      <label>
        Doğrulama kodu
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          required
          autoComplete="one-time-code"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Doğrulanıyor…" : "Yeni passkey oluştur"}
      </button>
    </form>
  );
}
