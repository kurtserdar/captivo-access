"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "cannot_disable_self":
      return "Kendinizi devre dışı bırakamazsınız.";
    case "forbidden":
      return "Bu işlem için yönetici yetkisi gerekli.";
    case "not_found":
      return "Kullanıcı bulunamadı.";
    default:
      return "İşlem başarısız, lütfen tekrar deneyin.";
  }
}

export function ToggleStatusButton({ userId, status }: { userId: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus = status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  const label = status === "ACTIVE" ? "Devre dışı bırak" : "Aktifleştir";

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }
      window.location.reload();
    } catch {
      setError("İşlem başarısız, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="link-button" onClick={handleClick} disabled={busy}>
        {busy ? "İşleniyor…" : label}
      </button>
      {error && <p role="alert">{error}</p>}
    </span>
  );
}
