import { db } from "@/lib/db";
import { countPendingGrants } from "@/lib/access/grants";

export type SetupStatus = {
  connectors: number;
  connectorsOnline: number;
  sites: number;
  grants: number;
  pending: number;
  sitesReachable: number;
  sitesUnreachable: number;
};

export async function getSetupStatus(): Promise<SetupStatus> {
  const [connectors, connectorsOnline, sites, grants, pending, sitesReachable, sitesUnreachable] =
    await Promise.all([
      db.connector.count(),
      db.connector.count({ where: { status: "ONLINE" } }),
      db.site.count(),
      db.accessGrant.count(),
      countPendingGrants(),
      db.site.count({ where: { probeOk: true } }),
      db.site.count({ where: { probeOk: false } }),
    ]);
  return { connectors, connectorsOnline, sites, grants, pending, sitesReachable, sitesUnreachable };
}
