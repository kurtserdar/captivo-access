"use client";

import { useState } from "react";

function decodedByteLength(base64: string): number {
  try {
    return atob(base64).length;
  } catch {
    return 0;
  }
}

export function TestConnectionButton({ siteId }: { siteId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body?.error) {
        setResult(`Failed: ${body.error}`);
        return;
      }
      if (typeof body?.status === "number") {
        const bytes = typeof body.bodyPreview === "string" ? decodedByteLength(body.bodyPreview) : 0;
        setResult(`HTTP ${body.status} · ${bytes} byte(s) received${body.truncated ? " (truncated)" : ""}`);
        return;
      }
      setResult("Unexpected response, please try again.");
    } catch {
      setResult("Couldn't reach the test endpoint, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="btn sm ghost" onClick={handleClick} disabled={busy}>
        {busy ? "Testing…" : "Test connection"}
      </button>
      {result && (
        <p className="notice" role="status">
          {result}
        </p>
      )}
    </span>
  );
}
