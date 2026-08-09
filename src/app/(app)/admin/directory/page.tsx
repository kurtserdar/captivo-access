import { requireCapability } from "@/lib/current-user";
import { getDirectoryConfig } from "@/lib/directory/config";
import { listGroupMappings } from "@/lib/directory/mappings";
import { db } from "@/lib/db";
import { LastVerified } from "@/app/(app)/_shell/last-verified";
import { DirectoryForm } from "./directory-form";
import { GroupMappings } from "./group-mappings";
import { ResolvePreview } from "./resolve-preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Directory (LDAP/AD)" };

export default async function AdminDirectoryPage() {
  await requireCapability("configure");
  const [cfg, connectors, mappings, sites] = await Promise.all([
    getDirectoryConfig(),
    db.connector.findMany({
      where: { status: { not: "REVOKED" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listGroupMappings(),
    db.site.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const initial = {
    enabled: cfg?.enabled ?? false,
    connectorId: cfg?.connectorId ?? "",
    host: cfg?.host ?? "",
    port: cfg?.port ?? 389,
    security: cfg?.security ?? ("STARTTLS" as const),
    insecureSkipVerify: cfg?.insecureSkipVerify ?? false,
    baseDN: cfg?.baseDN ?? "",
    bindDN: cfg?.bindDN ?? "",
    hasBindPassword: cfg?.hasBindPassword ?? false,
  };

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Directory (LDAP / Active Directory)</h1>
          <p>
            Reach the customer&apos;s internal directory through a connector, then map AD groups to console
            roles or site access. At login a user&apos;s role and grants are reconciled to their group
            membership, and a member who leaves every mapped group is automatically deprovisioned.
          </p>
        </div>
      </div>
      <div className="card">
        <LastVerified at={cfg?.lastTestedAt ?? null} ok={cfg?.lastTestOk ?? null} detail={cfg?.lastTestDetail ?? null} />
        <DirectoryForm initial={initial} connectors={connectors} />
      </div>
      <GroupMappings mappings={mappings} sites={sites} />
      <ResolvePreview />
    </main>
  );
}
