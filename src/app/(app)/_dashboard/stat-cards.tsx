import Link from "next/link";
import type { DashboardStats } from "@/lib/dashboard/stats";
import { healthTone } from "@/lib/dashboard/stats";

export function StatCards({ s }: { s: DashboardStats }) {
  const connTone = s.connectors === 0 ? "neutral" : s.connectorsOnline === s.connectors ? "ok" : "warn";
  const cards = [
    { k: "Connectors online", v: `${s.connectorsOnline}/${s.connectors}`, s: null, tone: connTone, href: "/admin/connectors" },
    { k: "Sites reachable", v: `${s.sitesReachable}/${s.sites}`, s: s.sitesDown > 0 ? `${s.sitesDown} down` : null, tone: healthTone(s.sitesReachable, s.sites), href: "/admin/sites" },
    { k: "Active grants", v: `${s.activeGrants}`, s: null, tone: "neutral", href: "/admin/grants" },
    { k: "Pending approvals", v: `${s.pending}`, s: null, tone: s.pending > 0 ? "warn" : "neutral", href: "/admin/grants" },
    { k: "Unread alerts", v: `${s.unreadAlerts}`, s: null, tone: s.unreadAlerts > 0 ? "danger" : "neutral", href: "/admin/notifications" },
  ] as const;
  return (
    <div className="stat-grid">
      {cards.map((c) => (
        <Link key={c.k} href={c.href} className={`stat-card ${c.tone}`}>
          <span className="k">{c.k}</span>
          <span className="v">{c.v}</span>
          {c.s && <span className="s">{c.s}</span>}
        </Link>
      ))}
    </div>
  );
}
