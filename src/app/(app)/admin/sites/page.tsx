import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { recordingEnabled } from "@/lib/recording/enabled";
import { SiteForm } from "./site-form";
import { TestConnectionButton } from "./test-connection-button";
import { DeleteSiteButton } from "./delete-site-button";
import { CopyButton } from "@/app/(app)/_shell/copy-button";

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

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Sites</h1>
          <p>
            A site is an internal upstream reachable through a connector, addressed by its real internal
            URL. Use &quot;Test connection&quot; to verify a live round trip through the connector&apos;s
            tunnel.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Add site</h2>
        </div>
        {connectors.length === 0 ? (
          <p>Add a connector first before creating a site.</p>
        ) : (
          <SiteForm connectors={connectors} recordingEnabled={recordingEnabled()} />
        )}
      </div>

      <h2>Configured sites</h2>
      {sites.length === 0 ? (
        <div className="empty">No sites yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Hostname</th>
                <th>Connector</th>
                <th>Internal address</th>
                <th>Description</th>
                <th>Health</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.accessMode === "GATEWAY" && (
                      <>
                        {" "}
                        <span className="pill neutral">Gateway</span>
                      </>
                    )}
                  </td>
                  <td className="cell-sub">
                    <span className="cell-inline">
                      <span className="cell-truncate" title={s.hostname}>{s.hostname}</span>
                      <CopyButton value={s.hostname} label="Copy" />
                    </span>
                  </td>
                  <td>{s.connector.name}</td>
                  <td className="cell-sub">
                    {s.upstreamUrl && (
                      <span className="cell-inline">
                        <span className="cell-truncate" title={s.upstreamUrl}>{s.upstreamUrl}</span>
                        <CopyButton value={s.upstreamUrl} label="Copy" />
                      </span>
                    )}
                  </td>
                  <td className="cell-sub">{s.description ?? "—"}</td>
                  <td>
                    {s.upstreamUrl == null ? (
                      <span className="pill neutral">No address</span>
                    ) : s.probeOk == null ? (
                      <span className="pill neutral">Not checked</span>
                    ) : s.probeOk ? (
                      <span className="pill ok">Reachable</span>
                    ) : (
                      <span className="pill danger">Unreachable</span>
                    )}
                    {s.probeDetail && s.probeOk === false && (
                      <div className="cell-sub">{s.probeDetail}</div>
                    )}
                    {s.probeOk === true && s.probeLatencyMs != null && (
                      <div className="cell-sub">{s.probeLatencyMs} ms</div>
                    )}
                    {s.probedAt && (
                      <div className="cell-sub">{timeAgo(s.probedAt)}</div>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <TestConnectionButton siteId={s.id} />
                      <Link href={`/admin/sites/${s.id}/edit`} className="btn sm">Edit</Link>
                      <DeleteSiteButton id={s.id} name={s.name} grantCount={s._count.grants} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
