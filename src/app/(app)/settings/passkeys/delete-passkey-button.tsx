"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "last_passkey":
      return "Son passkey silinemez.";
    case "not_found":
      return "Passkey bulunamadı.";
    case "unauthorized":
      return "Oturumunuz sona ermiş, lütfen tekrar giriş yapın.";
    default:
      return "Passkey silinemedi, lütfen tekrar deneyin.";
  }
}

export function DeletePasskeyButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm("Bu passkey'i silmek istediğinize emin misiniz?")) return;

    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/passkeys/${id}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }
      window.location.reload();
    } catch {
      setError("Passkey silinemedi, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        className="link-button"
        onClick={handleClick}
        disabled={busy || disabled}
        title={disabled ? "Son passkey silinemez" : undefined}
      >
        {busy ? "Siliniyor…" : "Sil"}
      </button>
      {error && <p role="alert">{error}</p>}
    </span>
  );
}
