import Link from "next/link";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listTenants } from "@/lib/platform/tenants";
import { recentAdminEvents, recentAccessEvents } from "@/lib/platform/sql";
import { PLATFORM_TENANT_ID } from "@/lib/tenant/constants";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { SectionHead } from "../../_shell/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ tenant?: string; kind?: string; limit?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind === "access" ? "access" : "admin";
  const limit = Math.min(500, Math.max(20, Number(sp.limit) || 100));
  const tenantFilter = sp.tenant && sp.tenant !== "all" ? sp.tenant : null;
  const { tenants, admin, access } = await withRequestTenant(async () => {
    await requirePlatformAdmin();
    const [tenants, admin, access] = await Promise.all([
      listTenants(),
      kind === "admin" ? recentAdminEvents(limit, tenantFilter) : Promise.resolve([]),
      kind === "access" ? recentAccessEvents(limit, tenantFilter) : Promise.resolve([]),
    ]);
    return { tenants, admin, access };
  });
  const nameOf = (id: string) => (id === PLATFORM_TENANT_ID ? "Platform" : tenants.find((t) => t.id === id)?.name ?? id);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>Admin actions (including everything the platform did to a tenant) and vendor access decisions, across every tenant.</p>
        </div>
      </div>
      <form method="get" className="row-actions" style={{ flexWrap: "wrap", marginBottom: 14 }}>
        <select className="select" name="tenant" defaultValue={tenantFilter ?? "all"}>
          <option value="all">All tenants</option>
          <option value={PLATFORM_TENANT_ID}>Platform (operators)</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
        </select>
        <select className="select" name="kind" defaultValue={kind}><option value="admin">Admin actions</option><option value="access">Access decisions</option></select>
        <select className="select" name="limit" defaultValue={String(limit)}>{[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n} rows</option>)}</select>
        <button className="btn" type="submit">Apply</button>
      </form>
      <div className="card">
        <SectionHead title={kind === "admin" ? "Admin actions" : "Access decisions"} sub={`${kind === "admin" ? admin.length : access.length} most recent${tenantFilter ? ` · ${nameOf(tenantFilter)}` : ""}`} />
        {kind === "admin" ? (
          admin.length === 0 ? <div className="empty">No admin actions recorded.</div> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Tenant</th><th>Actor</th><th>Action</th><th>Summary</th></tr></thead><tbody>
              {admin.map((e) => <tr key={e.id}><td className="cell-sub"><LocalTime iso={new Date(e.timestamp).toISOString()} mode="short" /></td><td>{e.tenantId === PLATFORM_TENANT_ID ? <span className="pill neutral">Platform</span> : <Link href={`/platform/tenants/${e.tenantId}`} className="link-button">{nameOf(e.tenantId)}</Link>}</td><td className="cell-sub">{e.actorEmail ?? "system"}</td><td className="cell-sub">{e.action}</td><td style={{ whiteSpace: "normal" }}>{e.summary}</td></tr>)}
            </tbody></table></div>
          )
        ) : (
          access.length === 0 ? <div className="empty">No access events recorded.</div> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Tenant</th><th>User</th><th>Resource</th><th>Decision</th><th>Reason</th></tr></thead><tbody>
              {access.map((e) => <tr key={e.id}><td className="cell-sub"><LocalTime iso={new Date(e.timestamp).toISOString()} mode="short" /></td><td><Link href={`/platform/tenants/${e.tenantId}`} className="link-button">{nameOf(e.tenantId)}</Link></td><td className="cell-sub">{e.userEmail ?? "—"}</td><td className="cell-sub">{e.siteName ?? e.host}</td><td><span className={`pill ${e.decision === "ALLOW" ? "ok" : "danger"}`}>{e.decision}</span></td><td className="cell-sub">{e.reason ?? ""}</td></tr>)}
            </tbody></table></div>
          )
        )}
      </div>
    </section>
  );
}
