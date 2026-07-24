"use client";

import { useState } from "react";

export function RevokeSessionButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm("Bu oturumu iptal etmek istediğinize emin misiniz?")) return;

    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError("İptal edilemedi, lütfen tekrar deneyin.");
        return;
      }
      window.location.reload();
    } catch {
      setError("İptal edilemedi, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="link-button" onClick={handleClick} disabled={busy}>
        {busy ? "İptal ediliyor…" : "İptal et"}
      </button>
      {error && <p role="alert">{error}</p>}
    </span>
  );
}
