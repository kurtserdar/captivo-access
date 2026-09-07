import { notFound } from "next/navigation";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!multiTenantEnabled()) notFound();
  await withRequestTenant(async () => requirePlatformAdmin());
  return (
    <div className="app">
      <header className="topnav">
        <span className="tn-brand">
          <span className="brand-word">Captivo</span>
          <span className="brand-access">Platform</span>
        </span>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
