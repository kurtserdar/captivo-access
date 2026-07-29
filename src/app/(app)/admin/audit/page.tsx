import Link from "next/link";
import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { listAuditEvents } from "@/lib/audit/query";
import { AuditTable, type AuditRowJSON } from "./audit-table";

export const dynamic = "force-dynamic";

const INITIAL_LIMIT = 50;

export default async function AdminAuditPage() {
  await requireAdmin();

  const [users, sites, { rows, total }] = await Promise.all([
    db.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listAuditEvents({ limit: INITIAL_LIMIT, offset: 0 }),
  ]);

  const initialRows: AuditRowJSON[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp.toISOString(),
    userId: r.userId,
    userEmail: r.userEmail,
    siteId: r.siteId,
    siteName: r.siteName,
    host: r.host,
    method: r.method,
    path: r.path,
    status: r.status,
    bytesOut: r.bytesOut,
    decision: r.decision,
    reason: r.reason,
    clientIp: r.clientIp,
  }));

  return (
    <main>
      <nav className="sub-nav">
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/sessions">Sessions</Link>
        <Link href="/admin/invites">Invites</Link>
        <Link href="/admin/connectors">Connectors</Link>
        <Link href="/admin/sites">Sites</Link>
        <Link href="/admin/grants">Grants</Link>
        <Link href="/admin/audit" className="active">
          Audit log
        </Link>
      </nav>

      <h1>Audit log</h1>
      <p>Every proxied request through a connector, with the access decision that was applied.</p>

      <AuditTable users={users} sites={sites} initialRows={initialRows} initialTotal={total} />
    </main>
  );
}
