import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { listUserGrants } from "@/lib/access/grants";
import { classifyGrant } from "@/lib/access/evaluate";
import { recordingEnabled } from "@/lib/recording/enabled";
import { listRecordings } from "@/lib/recording/query";
import { remaining } from "@/lib/portal/time-remaining";
import { securityStatus } from "@/lib/portal/security-status";
import { launchHref } from "@/lib/portal/launch-href";
import { PortalHome, type CardVM, type RecentVM } from "./portal-home";

export const dynamic = "force-dynamic";
export const metadata = { title: "My access" };

export default async function AccessPage() {
  const user = await requireUser();
  const now = new Date();
  const recEnabled = recordingEnabled();

  const [grants, passkeyCount, recentRes] = await Promise.all([
    listUserGrants(user.id),
    db.passkey.count({ where: { userId: user.id } }),
    listRecordings({ userId: user.id, limit: 3, offset: 0 }),
  ]);

  const cards: CardVM[] = [];
  const upcoming: CardVM[] = [];
  const siteName = new Map<string, string>();
  let anyRecorded = false;

  for (const g of grants) {
    const reason = classifyGrant(g, now);
    let status: CardVM["status"] | null = null;
    if (reason === "allow") status = "active";
    else if (reason === "not_yet") status = "upcoming";
    else if (reason === "off_schedule") status = "off_hours";
    else if (reason === "pending_approval") status = "pending";
    else if (reason === "denied") status = "denied";
    if (!status) continue; // expired/revoked not shown

    siteName.set(g.site.id, g.site.name);
    const recorded = recEnabled && g.site.recordSessions;
    if (recorded) anyRecorded = true;

    const startISO = g.startsAt ? g.startsAt.toISOString() : null;
    const endISO = g.endsAt ? g.endsAt.toISOString() : null;
    const card: CardVM = {
      id: g.id,
      siteName: g.site.name,
      hostname: g.site.hostname ?? "",
      accessMode: g.site.accessMode,
      hasLogo: g.site.logoType != null,
      siteId: g.site.id,
      glyph: g.site.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "··",
      status,
      denyReason: g.denyReason ?? null,
      href: launchHref(g.site.accessMode, g.site.id, g.site.hostname ?? ""),
      time: remaining(startISO, endISO, g.schedule ?? null, now),
    };
    if (status === "upcoming") {
      card.whenText = g.startsAt ? formatWhen(g.startsAt) : "Scheduled";
      upcoming.push(card);
    } else cards.push(card);
  }

  const recent: RecentVM[] = recentRes.rows.map((r) => ({
    id: r.id,
    name: siteName.get(r.siteId) ?? r.host,
    protocol: r.protocol ?? "",
    durationText: durationText(r.startedAt, r.lastEventAt),
  }));

  const security = securityStatus({ hasPasskey: passkeyCount > 0, anyRecorded });
  const activeCount = cards.filter((c) => c.status === "active").length;

  return (
    <PortalHome
      firstName={(user.name ?? "").split(" ")[0] || "there"}
      activeCount={activeCount}
      anyRecorded={anyRecorded}
      cards={cards}
      upcoming={upcoming}
      recent={recent}
      security={security}
    />
  );
}

function durationText(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m`;
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d) + " UTC";
}
