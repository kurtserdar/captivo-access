import Link from "next/link";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { platformSnapshot } from "@/lib/platform/overview";
import { TenantsTable, type TenantRowJSON } from "./tenants-table";
import { UserSearch } from "./user-search";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenants" };

export default async function TenantsPage() {
  const snap = await withRequestTenant(async () => {
    await requirePlatformAdmin();
    return platformSnapshot();
  });
  const rows: TenantRowJSON[] = snap.tenants.map((t) => ({
    id: t.id, slug: t.slug, name: t.name, status: t.status, plan: t.plan,
    trialEndsAt: t.trialEndsAt?.toISOString() ?? null, deletedAt: t.deletedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString(),
    users: t.stats?.users ?? 0, admins: t.stats?.admins ?? 0, sites: t.stats?.sites ?? 0, connectors: t.stats?.connectors ?? 0, connectorsOnline: t.stats?.connectorsOnline ?? 0,
    requestsPending: t.stats?.requestsPending ?? 0, lastActivity: t.stats?.lastActivity?.toISOString() ?? null,
    dns: t.health?.dns ?? "unknown", cert: t.health?.cert ?? "unknown", certDaysLeft: t.health?.certDaysLeft ?? null, cronStale: t.cron.stale, problems: t.problems,
  }));
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Tenants</h1>
          <p>Every organization on this platform. Open one to see its users, resources, activity and settings, or to act on it.</p>
        </div>
        <Link className="btn primary" href="/platform/new">New tenant</Link>
      </div>
      <TenantsTable rows={rows} />
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-head"><div><h2>Find a user</h2><div className="sub">Search every tenant by email — which organization is this person in, and with what role?</div></div></div>
        <UserSearch />
      </div>
    </section>
  );
}
