import { timeAgo } from "@/lib/format";

// Renders a "Last verified: <time ago> · OK/Failed" line for a config that
// records lastVerified* columns. Renders nothing if never verified. A failure
// detail can be long (e.g. a directory TLS error), so it wraps in its own block
// below the pill rather than inside it — the pill is nowrap and would overflow.
export function LastVerified({ at, ok, detail }: { at: Date | null; ok: boolean | null; detail: string | null }) {
  if (!at) return null;
  return (
    <div className="cell-sub">
      <span>
        Last verified: {timeAgo(at)} ·{" "}
        {ok ? <span className="pill ok">OK</span> : <span className="pill danger">Failed</span>}
      </span>
      {!ok && detail ? <div className="verify-detail">{detail}</div> : null}
    </div>
  );
}
