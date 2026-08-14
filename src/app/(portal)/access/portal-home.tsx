import { RequestAccessButton } from "./request-access-button";
import { AccessCards } from "./access-cards";
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
        <AccessCards cards={cards} />

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
