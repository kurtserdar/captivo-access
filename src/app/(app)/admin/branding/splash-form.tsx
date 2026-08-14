"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SplashForm({ hasSplash }: { hasSplash: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("The image must be 2 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => { setPreview(String(reader.result)); setType(file.type); };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/branding/splash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ splashImage: preview, splashImageType: type }) });
      if (res.ok) { setPreview(null); router.refresh(); }
      else { setError("Upload failed. Use a PNG/JPG/WebP/GIF under 2 MB."); }
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/branding/splash", { method: "DELETE" });
      if (res.ok) { setPreview(null); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="field" style={{ maxWidth: 460 }}>
      <div style={{ background: "#0b1220", borderRadius: 10, padding: 24, display: "flex", justifyContent: "center", minHeight: 120, alignItems: "center", marginBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview ?? (hasSplash ? "/api/branding/splash" : "")} alt="" style={{ maxHeight: 96, maxWidth: 300 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick} />
      {error && <p className="notice warn" role="alert" style={{ marginTop: 8 }}>{error}</p>}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy || !preview} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        {hasSplash && <button type="button" className="btn" disabled={busy} onClick={remove}>Remove</button>}
      </div>
    </div>
  );
}
