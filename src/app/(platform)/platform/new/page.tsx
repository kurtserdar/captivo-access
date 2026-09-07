import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { CreateTenantForm } from "./create-tenant-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New tenant" };

export default async function NewTenantPage() {
  await withRequestTenant(async () => requirePlatformAdmin());
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>New tenant</h1>
          <p>Provision a tenant and its first admin invite.</p>
        </div>
      </div>
      <CreateTenantForm />
    </section>
  );
}
