import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { SiteForm } from "./site-form";
import { TestConnectionButton } from "./test-connection-button";

export const dynamic = "force-dynamic";

export default async function AdminSitesPage() {
  await requireAdmin();

  const [sites, connectors] = await Promise.all([
    db.site.findMany({
      select: {
        id: true,
        name: true,
        upstreamName: true,
        description: true,
        connector: { select: { name: true, status: true } },
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
      <nav className="sub-nav">
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/sessions">Sessions</Link>
        <Link href="/admin/invites">Invites</Link>
        <Link href="/admin/connectors">Connectors</Link>
        <Link href="/admin/sites" className="active">
          Sites
        </Link>
      </nav>

      <h1>Sites</h1>
      <p>
        A site is an internal upstream reachable through a connector. The upstream name must match an
        entry in that connector&apos;s <code>UPSTREAMS</code> env. Use &quot;Test connection&quot; to
        verify a live round trip through the connector&apos;s tunnel.
      </p>

      {connectors.length === 0 ? (
        <p>Add a connector first before creating a site.</p>
      ) : (
        <SiteForm connectors={connectors} />
      )}

      <h2>Configured sites</h2>
      {sites.length === 0 ? (
        <p>No sites yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Connector</th>
              <th>Upstream</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.connector.name}</td>
                <td>{s.upstreamName}</td>
                <td>{s.description ?? "—"}</td>
                <td>
                  <TestConnectionButton siteId={s.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
