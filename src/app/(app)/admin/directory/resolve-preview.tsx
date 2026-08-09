"use client";

import { useState } from "react";

type PreviewResult = {
  ok: boolean;
  error?: string;
  found?: boolean;
  displayName?: string | null;
  groups?: string[];
  decision?: { deprovision: boolean; role: string | null; grantSiteIds: string[] };
};

export function ResolvePreview() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/admin/directory/resolve-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setResult(await res.json().catch(() => ({ ok: false, error: "Request failed." })));
    setBusy(false);
  }

  return (
    <div className="card">
      <h2>Test resolve</h2>
      <p className="cell-sub">Preview what a user would get on login — no changes are made.</p>
      <form onSubmit={run}>
        <div className="field">
          <label className="field-label" htmlFor="rp-email">Email</label>
          <input id="rp-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@corp.local" required />
        </div>
        <div className="row-actions">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Resolving…" : "Resolve"}</button>
        </div>
      </form>
      {result && !result.ok && <p className="notice error" role="alert">{result.error}</p>}
      {result && result.ok && (
        <div>
          {!result.found ? (
            <p className="notice">Not found in the directory{result.decision?.deprovision ? " — would deprovision (revoke access + disable)." : "."}</p>
          ) : (
            <>
              <p><strong>{result.displayName ?? email}</strong> — {result.groups?.length ?? 0} group(s)</p>
              {result.decision?.deprovision ? (
                <p className="notice error">Would deprovision: in none of the mapped groups.</p>
              ) : (
                <p className="notice success">
                  Would provision: role = <strong>{result.decision?.role ?? "(unchanged)"}</strong>; grants ={" "}
                  {result.decision?.grantSiteIds.length ? result.decision.grantSiteIds.join(", ") : "(none)"}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
