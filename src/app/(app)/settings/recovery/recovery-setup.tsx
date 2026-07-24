"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_code":
      return "Doğrulama kodu yanlış.";
    case "invalid_body":
      return "Doğrulama kodu gerekli.";
    case "unauthorized":
      return "Oturumunuz sona ermiş, lütfen tekrar giriş yapın.";
    default:
      return "Kurtarma kurulamadı, lütfen tekrar deneyin.";
  }
}

export function RecoverySetup({ accountName }: { accountName: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recovery/start", { method: "POST" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.secret) {
        setError(errorMessage(result?.error));
        return;
      }
      setSecret(result.secret);
      setOtpauth(result.otpauth);
    } catch {
      setError("Kurtarma kurulamadı, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!secret) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, secret }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }
      window.location.reload();
    } catch {
      setError("Kurtarma kurulamadı, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (!secret) {
    return (
      <div>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={handleStart} disabled={busy}>
          {busy ? "Hazırlanıyor…" : "Kurtarma kur"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleConfirm}>
      <p>
        Aşağıdaki anahtarı doğrulama uygulamanıza ({accountName} hesabı için)
        manuel olarak ekleyin, ardından üretilen 6 haneli kodu girin.
      </p>
      <code className="secret">{secret}</code>
      {otpauth && <code className="secret">{otpauth}</code>}
      <label>
        Doğrulama kodu
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoComplete="one-time-code"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Doğrulanıyor…" : "Doğrula ve etkinleştir"}
      </button>
    </form>
  );
}
