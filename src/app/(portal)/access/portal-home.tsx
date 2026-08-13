import { RequestAccessButton } from "./request-access-button";
import type { Remaining } from "@/lib/portal/time-remaining";
import type { StatusLine } from "@/lib/portal/security-status";

export interface CardVM {
  id: string;
  siteName: string;
  hostname: string;
  accessMode: string;
  hasLogo: boolean;
  siteId: string;
  glyph: string;
  status: "active" | "upcoming" | "off_hours" | "pending" | "denied";
  denyReason: string | null;
  href: string;
  time: Remaining;
  whenText?: string; // upcoming cards only: formatted start, e.g. "Aug 14, 09:00 UTC"
}
export interface RecentVM { id: string; name: string; protocol: string; durationText: string; }

const TONE_COLOR: Record<Remaining["tone"], string> = { urgent: "#dc2626", soon: "#d97706", ok: "#0f766e", schedule: "#78716c" };
const STATUS_DOT: Record<StatusLine["tone"], string> = { good: "#0f766e", info: "#dc2626", muted: "#a8a29e" };

export function PortalHome(props: {
  firstName: string; activeCount: number; anyRecorded: boolean;
  cards: CardVM[]; upcoming: CardVM[]; recent: RecentVM[]; security: StatusLine[];
  requireJustification: boolean;
}) {
  const { firstName, activeCount, anyRecorded, cards, upcoming, recent, security, requireJustification } = props;
  return (
    <div className="vp-home">
      <div className="vp-head">
        <div>
          <h1 className="vp-greet">Welcome back, {firstName}</h1>
          <p className="vp-sub">{activeCount} active grant{activeCount === 1 ? "" : "s"}{anyRecorded ? " · all sessions on this workspace are recorded" : ""}</p>
        </div>
        <RequestAccessButton requireJustification={requireJustification} />
      </div>

      <div className="vp-grid">
        <div className="vp-cards">
          {cards.length === 0 ? (
            <div className="vp-empty">You don&apos;t have any access yet.</div>
          ) : cards.map((c) => (
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
        </div>

        <div className="vp-rail">
          <div className="vp-railcard">
            <div className="vp-railtitle">Security status</div>
            {security.map((s, i) => (
              <div key={i} className="vp-statusline"><span className="vp-dot" style={{ background: STATUS_DOT[s.tone] }} />{s.label}</div>
            ))}
          </div>
          <div className="vp-railcard">
            <div className="vp-railtitle">Upcoming</div>
            {upcoming.length === 0 ? <div className="vp-muted">Nothing scheduled.</div> : upcoming.map((u) => (
              <div key={u.id} className="vp-upcoming"><div className="vp-upcoming-name">{u.siteName}</div><div className="vp-upcoming-when">{u.whenText ?? u.time.text}</div></div>
            ))}
          </div>
          <div className="vp-railcard">
            <div className="vp-railtitle">Recent sessions</div>
            {recent.length === 0 ? <div className="vp-muted">No sessions yet.</div> : recent.map((r) => (
              <div key={r.id} className="vp-recent"><span className="vp-recent-name">{r.name}</span><span className="vp-recent-meta">{r.durationText}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="vp-footer">Need something that isn&apos;t listed? Your request goes to the resource owner for approval.</div>
    </div>
  );
}
