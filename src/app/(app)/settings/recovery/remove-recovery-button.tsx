"use client";

import { useState } from "react";

export function RemoveRecoveryButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm("Kurtarma kodunu kaldırmak istediğinize emin misiniz?")) return;

    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recovery", { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("Kurtarma kaldırılamadı, lütfen tekrar deneyin.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Kurtarma kaldırılamadı, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="link-button" onClick={handleClick} disabled={busy}>
        {busy ? "Kaldırılıyor…" : "Kurtarmayı kaldır"}
      </button>
    </div>
  );
}
