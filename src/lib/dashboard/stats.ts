import { db } from "@/lib/db";
import { countPendingGrants } from "@/lib/access/grants";

export type SetupStatus = {
  connectors: number;
  connectorsOnline: number;
  sites: number;
  grants: number;
  pending: number;
};

export async function getSetupStatus(): Promise<SetupStatus> {
  const [connectors, connectorsOnline, sites, grants, pending] = await Promise.all([
    db.connector.count(),
    db.connector.count({ where: { status: "ONLINE" } }),
    db.site.count(),
    db.accessGrant.count(),
    countPendingGrants(),
  ]);
  return { connectors, connectorsOnline, sites, grants, pending };
}
