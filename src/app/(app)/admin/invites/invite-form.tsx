"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_body":
    case "name_email_role_required":
      return "Ad, e-posta ve rol gerekli.";
    case "forbidden":
      return "Bu işlem için yönetici yetkisi gerekli.";
    default:
      return "Davet oluşturulamadı, lütfen tekrar deneyin.";
  }
}

export function InviteForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VENDOR" | "ADMIN">("VENDOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLink(null);
    setCopied(false);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.link) {
        setError(errorMessage(result?.error));
        return;
      }
      setLink(result.link);
      setName("");
      setEmail("");
      setRole("VENDOR");
    } catch {
      setError("Davet oluşturulamadı, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <label>
          Ad Soyad
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
        <label>
          E-posta
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Rol
          <select value={role} onChange={(e) => setRole(e.target.value as "VENDOR" | "ADMIN")}>
            <option value="VENDOR">Tedarikçi</option>
            <option value="ADMIN">Yönetici</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Oluşturuluyor…" : "Davet oluştur"}
        </button>
      </form>

      {link && (
        <div role="status">
          <p>Bu bağlantı yalnızca bir kez gösterilir. Kaydetmeden bu sayfadan ayrılmayın.</p>
          <input type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={handleCopy}>
            {copied ? "Kopyalandı" : "Kopyala"}
          </button>
        </div>
      )}
    </div>
  );
}
