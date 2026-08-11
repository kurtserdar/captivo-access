import { requireAdmin } from "@/lib/current-user";
import { SitesIcon } from "@/components/icons";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { recordingEnabled } from "@/lib/recording/enabled";
import { AddSiteButton } from "./add-site-button";
import { SitesView, type SiteRow } from "./sites-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sites" };

export default async function AdminSitesPage() {
  await requireAdmin();

  const [sites, connectors] = await Promise.all([
    db.site.findMany({
      select: {
        id: true,
        name: true,
        hostname: true,
        upstreamUrl: true,
        description: true,
        probedAt: true,
        probeOk: true,
        probeDetail: true,
        probeLatencyMs: true,
        accessMode: true,
        connectorId: true,
        insecureSkipVerify: true,
        recordSessions: true,
        clipboardMode: true,
        logoType: true,
        connector: { select: { name: true, status: true } },
        _count: { select: { grants: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.connector.findMany({
      where: { status: { not: "REVOKED" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows: SiteRow[] = sites.map((s) => ({
    id: s.id,
    name: s.name,
    hostname: s.hostname ?? "",
    upstreamUrl: s.upstreamUrl,
    description: s.description,
    accessMode: s.accessMode,
    hasLogo: s.logoType != null,
    connectorId: s.connectorId,
    insecureSkipVerify: s.insecureSkipVerify,
    recordSessions: s.recordSessions,
    clipboardMode: s.clipboardMode,
    connectorName: s.connector.name,
    grantCount: s._count.grants,
    probeOk: s.probeOk,
    probeDetail: s.probeDetail,
    probeLatencyMs: s.probeLatencyMs,
    probedAgo: s.probedAt ? timeAgo(s.probedAt) : null,
  }));

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="page-title-row"><span className="page-icon"><SitesIcon /></span><h1>Sites</h1></div>
          <p>
            A site is an internal upstream reachable through a connector, addressed by its real internal
            URL. Use &quot;Test connection&quot; to verify a live round trip through the connector&apos;s
            tunnel.
          </p>
        </div>
        {connectors.length > 0 && <AddSiteButton connectors={connectors} recordingEnabled={recordingEnabled()} />}
      </div>

      {connectors.length === 0 ? (
        <div className="empty">Add a connector first before creating a site.</div>
      ) : sites.length === 0 ? (
        <div className="empty">No sites yet — use &quot;Add site&quot; to publish an internal app.</div>
      ) : (
        <SitesView sites={rows} connectors={connectors} recordingEnabled={recordingEnabled()} />
      )}
    </main>
  );
}
