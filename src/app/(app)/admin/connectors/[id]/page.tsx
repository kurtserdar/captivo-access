import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { managerVersion } from "@/lib/version";
import { isConnectorOutdated } from "@/lib/updates/semver";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { getConnectorTelemetry } from "@/lib/connector/telemetry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connector" };

const STATUS_PILL: Record<string, string> = { PENDING: "warn", ONLINE: "ok", OFFLINE: "neutral", REVOKED: "danger" };

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}
function humanDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function ConnectorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const connector = await db.connector.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      lastSeenAt: true,
      remoteAddr: true,
      gatewayHost: true,
      sites: { select: { id: true, name: true, hostname: true, probeOk: true }, orderBy: { name: "asc" } },
    },
  });
  if (!connector) notFound();

  const siteIds = connector.sites.map((s) => s.id);
  const [tele, activity] = await Promise.all([
    getConnectorTelemetry(connector.id),
    siteIds.length
      ? db.auditEvent.findMany({
          where: { siteId: { in: siteIds } },
          orderBy: { timestamp: "desc" },
          take: 25,
          select: { id: true, timestamp: true, userEmail: true, siteName: true, method: true, path: true, decision: true },
        })
      : Promise.resolve([]),
  ]);

  const mgr = managerVersion();
  const outdated = isConnectorOutdated(connector.version, mgr);
  const t = tele.online ? tele.telemetry : null;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>{connector.name}</h1>
          <p>
            <span className={`pill ${STATUS_PILL[connector.status] ?? "neutral"}`}>{connector.status}</span>
            {connector.gatewayHost && <span className="pill neutral" style={{ marginLeft: ".4rem" }}>Gateway</span>}
          </p>
        </div>
        <Link href="/admin/connectors" className="btn sm">← All connectors</Link>
      </div>

      <div className="card">
        <div className="card-head"><h2>Overview</h2></div>
        <div className="site-card-meta">
          <div className="site-card-mrow"><span className="site-card-k">Version</span><span className="site-card-v">{connector.version ?? "—"}{outdated && <span className="pill warn" style={{ marginLeft: ".4rem" }}>Outdated</span>}</span></div>
          <div className="site-card-mrow"><span className="site-card-k">Last seen</span><span className="site-card-v">{connector.lastSeenAt ? <LocalTime iso={connector.lastSeenAt.toISOString()} /> : "Never"}</span></div>
          <div className="site-card-mrow"><span className="site-card-k">Remote address</span><span className="site-card-v">{connector.remoteAddr ?? "—"}</span></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Live telemetry</h2></div>
        {t ? (
          <div className="stat-grid">
            <div className="stat-card neutral"><span className="k">Active connections</span><span className="v">{t.activeConnections}</span></div>
            <div className="stat-card neutral"><span className="k">Total handled</span><span className="v">{t.totalConnections}</span></div>
            <div className="stat-card neutral"><span className="k">Uptime</span><span className="v">{humanDuration(t.uptimeSec)}</span></div>
            <div className={`stat-card ${t.deniedCount > 0 ? "warn" : "neutral"}`}><span className="k">Denied attempts</span><span className="v">{t.deniedCount}</span></div>
            <div className="stat-card neutral"><span className="k">Bytes in</span><span className="v">{humanBytes(t.bytesIn)}</span></div>
            <div className="stat-card neutral"><span className="k">Bytes out</span><span className="v">{humanBytes(t.bytesOut)}</span></div>
          </div>
        ) : (
          <p className="cell-sub">No live data — the connector is offline or hasn&apos;t been updated to report telemetry yet.</p>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Sites on this connector</h2></div>
        {connector.sites.length === 0 ? (
          <div className="empty">No sites yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Hostname</th><th>Health</th></tr></thead>
              <tbody>
                {connector.sites.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="cell-sub">{s.hostname}</td>
                    <td>{s.probeOk == null ? <span className="pill neutral">Not checked</span> : s.probeOk ? <span className="pill ok">Reachable</span> : <span className="pill danger">Unreachable</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Recent activity</h2></div>
        {activity.length === 0 ? (
          <div className="empty">No access activity yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>User</th><th>Site</th><th>Request</th><th>Decision</th></tr></thead>
              <tbody>
                {activity.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-sub"><LocalTime iso={e.timestamp.toISOString()} /></td>
                    <td className="cell-sub">{e.userEmail ?? "—"}</td>
                    <td className="cell-sub">{e.siteName ?? "—"}</td>
                    <td className="cell-sub" style={{ maxWidth: "22ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.method} {e.path}</td>
                    <td><span className={`pill ${e.decision === "ALLOW" ? "ok" : "danger"}`}>{e.decision === "ALLOW" ? "Allowed" : "Denied"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
