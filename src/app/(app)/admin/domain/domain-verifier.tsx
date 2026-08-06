"use client";
import { useState } from "react";

type Result = { status: string; record?: string; expectedIp?: string; resolvedIp?: string | null; reason?: string };

const MESSAGES: Record<string, { ok: boolean; msg: string }> = {
  ok: { ok: true, msg: "Wildcard DNS is set — new apps will work automatically." },
  missing: { ok: false, msg: "No wildcard record found yet — add the record above and try again (DNS can take a few minutes)." },
  mismatch: { ok: false, msg: "The wildcard resolves to a different address than this server." },
  undetermined: { ok: false, msg: "Couldn't determine your domain — set MANAGER_PUBLIC_URL first." },
};

// When the domain is set but the manager hostname has no A record yet, the
// "set MANAGER_PUBLIC_URL first" advice is wrong — steer to DNS/propagation.
const UNDETERMINED_BY_REASON: Record<string, { ok: boolean; msg: string }> = {
  manager_unresolved: { ok: false, msg: "Your manager hostname isn't resolving yet — check its DNS and propagation." },
};

function messageFor(result: Result): { ok: boolean; msg: string } {
  if (result.status === "undetermined" && result.reason) {
    const byReason = UNDETERMINED_BY_REASON[result.reason];
    if (byReason) return byReason;
  }
  return MESSAGES[result.status] ?? { ok: false, msg: "Verification failed — try again." };
}

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

  const m = result ? messageFor(result) : null;

  return (
    <div>
      <button className="btn" onClick={verify} disabled={busy || !canVerify}>
        {busy ? "Checking…" : "Verify DNS"}
      </button>
      {m && (
        <p className={`notice ${m.ok ? "success" : "error"}`} role="status">
          {m.msg}
          {result?.status === "mismatch" && result.expectedIp && result.resolvedIp && (
            <> (expected {result.expectedIp}, got {result.resolvedIp})</>
          )}
        </p>
      )}
    </div>
  );
}
