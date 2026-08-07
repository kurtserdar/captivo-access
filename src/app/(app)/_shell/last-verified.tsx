import { timeAgo } from "@/lib/format";

// Renders a "Last verified: <time ago> · OK/Failed" line for a config that
// records lastVerified* columns. Renders nothing if never verified.
export function LastVerified({ at, ok, detail }: { at: Date | null; ok: boolean | null; detail: string | null }) {
  if (!at) return null;
  return (
    <p className="cell-sub">
      Last verified: {timeAgo(at)} ·{" "}
      {ok ? (
        <span className="pill ok">OK</span>
      ) : (
        <span className="pill danger">Failed{detail ? `: ${detail}` : ""}</span>
      )}
    </p>
  );
}
