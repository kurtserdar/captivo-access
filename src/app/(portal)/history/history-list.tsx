"use client";
import { useState } from "react";
import type { HistoryRowJSON } from "@/lib/portal/history";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

export function HistoryList({ initial, pageSize }: { initial: HistoryRowJSON[]; pageSize: number }) {
  const [rows, setRows] = useState<HistoryRowJSON[]>(initial);
  const [done, setDone] = useState(initial.length < pageSize);
  const [busy, setBusy] = useState(false);

  async function loadMore() {
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/history?offset=${rows.length}`);
      const data = (await res.json()) as { rows: HistoryRowJSON[] };
      setRows((r) => [...r, ...data.rows]);
      if (data.rows.length < pageSize) setDone(true);
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  if (rows.length === 0) return <div className="vp-empty">No sessions yet.</div>;
  return (
    <div className="vp-railcard">
      {rows.map((r) => (
        <div key={r.id} className="vp-recent">
          <span className="vp-recent-name">{r.name}{r.protocol ? ` · ${r.protocol.toUpperCase()}` : ""}</span>
          <span className="vp-recent-meta">{fmtDate(r.date)} · {r.durationText}</span>
        </div>
      ))}
      {!done && (
        <button type="button" className="vp-loadmore" disabled={busy} onClick={loadMore}>
          {busy ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
