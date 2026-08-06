"use client";
import { useState } from "react";

type Result = { status: string; record?: string; expectedIp?: string; resolvedIp?: string | null; reason?: string };

const MESSAGES: Record<string, { ok: boolean; msg: string }> = {
  ok: { ok: true, msg: "Wildcard DNS is set — new apps will work automatically." },
  missing: { ok: false, msg: "No wildcard record found yet — add the record above and try again (DNS can take a few minutes)." },
  mismatch: { ok: false, msg: "The wildcard resolves to a different address than this server." },
  undetermined: { ok: false, msg: "Couldn't determine your domain — set MANAGER_PUBLIC_URL first." },
};

export function DomainVerifier({ canVerify }: { canVerify: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function verify() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/domain/verify", { method: "POST" });
      setResult((await res.json()) as Result);
    } catch {
      setResult({ status: "error" });
    } finally {
      setBusy(false);
    }
  }

  const m = result ? MESSAGES[result.status] ?? { ok: false, msg: "Verification failed — try again." } : null;

  return (
    <div>
      <button className="btn" onClick={verify} disabled={busy || !canVerify}>
        {busy ? "Checking…" : "Verify DNS"}
      </button>
      {m && (
        <p className={`notice ${m.ok ? "ok" : "error"}`} role="status">
          {m.msg}
          {result?.status === "mismatch" && result.expectedIp && result.resolvedIp && (
            <> (expected {result.expectedIp}, got {result.resolvedIp})</>
          )}
        </p>
      )}
    </div>
  );
}
