import Link from "next/link";
import type { DashboardStats } from "@/lib/dashboard/stats";
import { healthTone } from "@/lib/dashboard/stats";
import { ConnectorsIcon, SitesIcon, GrantsIcon } from "@/components/icons";

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function StatCards({ s }: { s: DashboardStats }) {
  const connTone = s.connectors === 0 ? "neutral" : s.connectorsOnline === s.connectors ? "ok" : "warn";
  const cards = [
    { k: "Connectors online", v: `${s.connectorsOnline}/${s.connectors}`, sub: null, tone: connTone, href: "/admin/connectors", Icon: ConnectorsIcon },
    { k: "Sites reachable", v: `${s.sitesReachable}/${s.sites}`, sub: s.sitesDown > 0 ? `${s.sitesDown} down` : null, tone: healthTone(s.sitesReachable, s.sites), href: "/admin/sites", Icon: SitesIcon },
    { k: "Active grants", v: `${s.activeGrants}`, sub: null, tone: "neutral", href: "/admin/grants", Icon: GrantsIcon },
    { k: "Pending approvals", v: `${s.pending}`, sub: s.pending > 0 ? "awaiting review" : null, tone: s.pending > 0 ? "warn" : "neutral", href: "/admin/grants", Icon: ClockIcon },
    { k: "Unread alerts", v: `${s.unreadAlerts}`, sub: null, tone: s.unreadAlerts > 0 ? "danger" : "neutral", href: "/admin/notifications", Icon: BellIcon },
  ] as const;
  return (
    <div className="stat-grid">
      {cards.map((c) => {
        const Icon = c.Icon;
        return (
          <Link key={c.k} href={c.href} className={`stat-card ${c.tone}`}>
            <span className="stat-icon" aria-hidden="true"><Icon /></span>
            <span className="k">{c.k}</span>
            <span className="v">{c.v}</span>
            {c.sub && <span className="s">{c.sub}</span>}
          </Link>
        );
      })}
    </div>
  );
}
