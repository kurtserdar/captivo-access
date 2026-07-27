"use client";

import { useState } from "react";
import type { DecisionReason } from "@/lib/access/evaluate";

const REASON_LABEL: Record<Exclude<DecisionReason, "allow">, string> = {
  no_grant: "No grant for this site",
  not_yet: "Grant not active yet",
  expired: "Grant expired",
  revoked: "Grant revoked",
  pending_approval: "Awaiting approval",
  user_disabled: "User is disabled",
};

type CheckResult = { allow: boolean; reason: DecisionReason } | { error: string };

export function TestAccessWidget({
  users,
  sites,
}: {
  users: { id: string; name: string; email: string }[];
  sites: { id: string; name: string }[];
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function handleCheck() {
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/grants/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, siteId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.allow !== "boolean") {
        setResult({ error: "Couldn't check access, please try again." });
        return;
      }
      setResult({ allow: body.allow, reason: body.reason });
    } catch {
      setResult({ error: "Couldn't check access, please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Test access</h2>
      <p>Pick a user and a site to see the live access decision.</p>
      <label>
        User
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </label>
      <label>
        Site
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={handleCheck} disabled={busy || !userId || !siteId}>
        {busy ? "Checking…" : "Check access"}
      </button>
      {result && "error" in result && <p role="alert">{result.error}</p>}
      {result && "allow" in result && (
        <p className={`result-badge ${result.allow ? "allow" : "deny"}`} role="status">
          {result.allow ? "Allowed" : `Denied — ${REASON_LABEL[result.reason as Exclude<DecisionReason, "allow">]}`}
        </p>
      )}
    </section>
  );
}
