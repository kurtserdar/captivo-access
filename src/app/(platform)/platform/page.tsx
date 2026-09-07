import Link from "next/link";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listTenants } from "@/lib/platform/tenants";
import { StatusToggle } from "./status-toggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tenants" };

const STATUS_PILL: Record<string, string> = { ACTIVE: "ok", SUSPENDED: "danger" };

export default async function TenantsPage() {
  const tenants = await withRequestTenant(async () => {
    await requirePlatformAdmin();
    return listTenants();
  });

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Tenants</h1>
          <p>All tenants provisioned on this platform.</p>
        </div>
        <Link className="btn primary" href="/platform/new">New tenant</Link>
      </div>

      {tenants.length === 0 ? (
        <div className="empty">No tenants yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Admins</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="cell-sub">{t.slug}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[t.status] ?? "neutral"}`}>{t.status}</span>
                  </td>
                  <td className="cell-sub">{t.adminCount}</td>
                  <td className="cell-sub">{new Date(t.createdAt).toISOString().slice(0, 10)}</td>
                  <td><StatusToggle id={t.id} status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
