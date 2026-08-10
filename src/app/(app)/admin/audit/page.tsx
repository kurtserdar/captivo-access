import { requireCapability } from "@/lib/current-user";
import { AuditIcon } from "@/components/icons";
import { db } from "@/lib/db";
import { listAuditEvents } from "@/lib/audit/query";
import { resolvedExternalAnchorEnabled } from "@/lib/settings/platform";
import { AuditTable, type AuditRowJSON } from "./audit-table";
import { IntegrityPanel } from "./integrity-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const INITIAL_LIMIT = 50;

export default async function AdminAuditPage() {
  await requireCapability("read_console");

  const [users, sites, { rows, total }] = await Promise.all([
    db.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listAuditEvents({ limit: INITIAL_LIMIT, offset: 0 }),
  ]);

  const [anchorEnabled, anchorCount, lastAnchor] = await Promise.all([
    resolvedExternalAnchorEnabled(),
    db.auditAnchor.count(),
    db.auditAnchor.findFirst({
      orderBy: { anchoredSeq: "desc" },
      select: { anchoredSeq: true, genTime: true, tsaUrl: true },
    }),
  ]);
  const anchor = {
    enabled: anchorEnabled,
    count: anchorCount,
    last: lastAnchor
      ? { anchoredSeq: lastAnchor.anchoredSeq.toString(), genTime: lastAnchor.genTime.toISOString(), tsaUrl: lastAnchor.tsaUrl }
      : null,
  };

  const initialRows: AuditRowJSON[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp.toISOString(),
    userId: r.userId,
    userEmail: r.userEmail,
    userName: r.userName,
    company: r.company,
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
      <div className="page-head">
        <div>
          <div className="page-title-row"><span className="page-icon"><AuditIcon /></span><h1>Audit log</h1></div>
          <p>Every proxied request through a connector, with the access decision that was applied.</p>
        </div>
      </div>

      <IntegrityPanel anchor={anchor} />

      <AuditTable users={users} sites={sites} initialRows={initialRows} initialTotal={total} />
    </main>
  );
}
