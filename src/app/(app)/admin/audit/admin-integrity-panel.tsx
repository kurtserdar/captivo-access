"use client";
import { useState } from "react";

type Verdict = { ok: boolean; count: number; brokenAtSeq: string | null; reason: string | null } | null;

type AnchorProp = {
  enabled: boolean;
  count: number;
  last: { anchoredSeq: string; genTime: string; tsaUrl: string } | null;
};

type AnchorVerdict = {
  id: string;
  anchoredSeq: string;
  genTime: string | null;
  ok: boolean;
  beyondRetention: boolean;
  reason: string | null;
};

export function AdminIntegrityPanel({ anchor }: { anchor?: AnchorProp }) {
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [busy, setBusy] = useState(false);
  const [anchorVerdicts, setAnchorVerdicts] = useState<AnchorVerdict[] | null>(null);
  const [anchorBusy, setAnchorBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/audit/admin-verify");
      setVerdict((await res.json()) as Verdict);
    } catch {
      setVerdict({ ok: false, count: 0, brokenAtSeq: null, reason: "request_failed" });
    }
    setBusy(false);
  }

  async function verifyAnchors() {
    setAnchorBusy(true);
    setAnchorVerdicts(null);
    try {
      const res = await fetch("/api/admin/audit/admin-anchors/verify", { method: "POST" });
      const body = (await res.json()) as { verdicts: AnchorVerdict[] };
      setAnchorVerdicts(body.verdicts);
    } catch {
      setAnchorVerdicts([]);
    }
    setAnchorBusy(false);
  }

  return (
    <div className="aa-integrity">
      <button type="button" className="btn sm" onClick={verify} disabled={busy}>{busy ? "Verifying…" : "Verify chain"}</button>
      {verdict && (
        verdict.ok
          ? <span className="aa-ok">✓ Chain intact ({verdict.count} record{verdict.count === 1 ? "" : "s"})</span>
          : <span className="aa-bad">✗ Tampering detected{verdict.brokenAtSeq ? ` at #${verdict.brokenAtSeq}` : ""}{verdict.reason ? ` (${verdict.reason})` : ""}</span>
      )}

      {anchor?.enabled && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid var(--line)", paddingTop: ".9rem", width: "100%" }}>
          <div className="card-head" style={{ marginBottom: 0, paddingBottom: 0, border: "none" }}>
            <div>
              <b>External anchor</b>{" "}
              <span className="sub">
                {anchor.last
                  ? `Last: seq ${anchor.last.anchoredSeq} · ${new Date(anchor.last.genTime).toLocaleString()} · ${anchor.count} anchor(s) · ${anchor.last.tsaUrl}`
                  : "Enabled, but no anchor recorded yet (runs daily)."}
              </span>
            </div>
            {anchor.count > 0 && (
              <button className="btn sm" onClick={verifyAnchors} disabled={anchorBusy}>
                {anchorBusy ? "Verifying…" : "Verify anchors"}
              </button>
            )}
          </div>
          {anchorVerdicts && (
            <div className="table-wrap" style={{ marginTop: ".6rem" }}>
              <table className="table">
                <thead>
                  <tr><th>Seq</th><th>Timestamp</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {anchorVerdicts.map((v) => (
                    <tr key={v.id}>
                      <td>{v.anchoredSeq}</td>
                      <td className="cell-sub">{v.genTime ? new Date(v.genTime).toLocaleString() : "—"}</td>
                      <td>
                        {v.ok ? (
                          <span className="pill ok">{v.beyondRetention ? "Verified (beyond retention)" : "Verified"}</span>
                        ) : (
                          <span className="pill danger">Failed: {v.reason}</span>
                        )}
                      </td>
                      <td>
                        <a className="btn sm ghost" href={`/api/admin/audit/admin-anchors/${v.id}/token`}>Download .tsr</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
