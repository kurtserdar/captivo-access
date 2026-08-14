"use client";

import { useMemo, useState } from "react";
import type { Remaining } from "@/lib/portal/time-remaining";
import type { CardVM } from "./portal-home";

const TONE_COLOR: Record<Remaining["tone"], string> = { urgent: "#dc2626", soon: "#d97706", ok: "#0f766e", schedule: "#78716c" };
const PAGE_SIZE = 12;

// Client-side search + pagination over the vendor's access cards. Both aids only
// appear once the list is large enough to need them.
export function AccessCards({ cards }: { cards: CardVM[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cards;
    return cards.filter((c) => c.siteName.toLowerCase().includes(s) || c.hostname.toLowerCase().includes(s));
  }, [cards, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pageCount - 1);
  const shown = filtered.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="vp-cards">
      {cards.length > 6 && (
        <input
          className="vp-search"
          type="search"
          placeholder="Search resources…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          aria-label="Search resources"
        />
      )}

      {filtered.length === 0 ? (
        <div className="vp-empty">{cards.length === 0 ? "You don't have any access yet." : "No resources match your search."}</div>
      ) : shown.map((c) => (
        <div key={c.id} className="vp-card">
          <div className="vp-card-top">
            <div className="vp-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.hasLogo ? <img src={`/api/sites/${c.siteId}/logo`} alt="" width={44} height={44} className="vp-icon-img" /> : c.glyph}
            </div>
            <div className="vp-card-id">
              <div className="vp-card-title"><span className="vp-card-name">{c.siteName}</span><span className="vp-chip">{c.accessMode === "GATEWAY" ? "REMOTE" : "WEB"}</span></div>
              <div className="vp-card-host">{c.hostname}</div>
            </div>
            {c.status === "active"
              ? <a className="vp-open" href={c.href} target="_blank" rel="noopener noreferrer">Open ↗</a>
              : <span className="vp-open vp-open-off">{c.status === "pending" ? "Pending" : c.status === "off_hours" ? "Off hours" : c.status === "denied" ? "Denied" : "—"}</span>}
          </div>
          <div className="vp-meter">
            <div className="vp-meter-row"><span className="vp-meter-label">{c.status === "denied" ? (c.denyReason ?? "Not available") : "Access window"}</span><span className="vp-meter-remain" style={{ color: TONE_COLOR[c.time.tone] }}>{c.time.text}</span></div>
            <div className="vp-bar"><div className="vp-bar-fill" style={{ width: `${c.time.pct}%`, background: TONE_COLOR[c.time.tone] }} /></div>
          </div>
        </div>
      ))}

      {pageCount > 1 && (
        <div className="vp-pager">
          <button type="button" className="vp-pager-btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← Prev</button>
          <span className="vp-pager-info">Page {cur + 1} of {pageCount}</span>
          <button type="button" className="vp-pager-btn" disabled={cur >= pageCount - 1} onClick={() => setPage(cur + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
