import { requireCapability } from "@/lib/current-user";
import { db } from "@/lib/db";
import { getUpdateCheckConfig } from "@/lib/updates/update-check-config";
import { isUpdateAvailable, isConnectorOutdated } from "@/lib/updates/semver";
import { connectorTunnelUrl } from "@/lib/url";
import { buildConnectorUpdateCommand } from "@/lib/connector/repair";
import { managerVersion } from "@/lib/version";
import { UpdatesForm } from "./updates-form";
import { UpgradeGuide } from "./upgrade-guide";

export const dynamic = "force-dynamic";
export const metadata = { title: "Updates" };

export default async function AdminUpdatesPage() {
  await requireCapability("configure");
  const cfg = await getUpdateCheckConfig();
  const mgr = managerVersion();
  const updateAvailable = isUpdateAvailable(cfg?.latestVersion, mgr);

  // Only when an update is available do we look at connector drift and build the
  // per-connector command (the token volume is kept, so it's a plain update).
  let outdatedConnectors = 0;
  let connectorCommand: string | null = null;
  let hasGatewayHost = false;
  if (updateAvailable) {
    const connectors = await db.connector.findMany({
      where: { status: { not: "REVOKED" } },
      select: { version: true, gatewayHost: true },
    });
    const outdated = connectors.filter((c) => isConnectorOutdated(c.version, mgr));
    outdatedConnectors = outdated.length;
    hasGatewayHost = outdated.some((c) => c.gatewayHost);
    if (outdatedConnectors > 0) {
      const managerUrl = process.env.MANAGER_PUBLIC_URL?.replace(/\/+$/, "") || "https://manager.<your-access-domain>";
      connectorCommand = buildConnectorUpdateCommand(managerUrl, connectorTunnelUrl());
    }
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Updates</h1>
          <p>See when a newer version of Captivo Access is available. Connectors older than the manager are flagged under Connectors.</p>
        </div>
      </div>
      <div className="card">
        <UpdatesForm
          initialEnabled={cfg?.enabled ?? true}
          currentVersion={mgr}
          latestVersion={cfg?.latestVersion ?? null}
          lastCheckedAt={cfg?.lastCheckedAt ? cfg.lastCheckedAt.toISOString() : null}
          lastCheckOk={cfg?.lastCheckOk ?? null}
        />
      </div>
      {updateAvailable && (
        <UpgradeGuide
          currentVersion={mgr}
          latestVersion={cfg?.latestVersion ?? ""}
          latestUrl={cfg?.latestUrl ?? null}
          connectorCommand={connectorCommand}
          outdatedConnectors={outdatedConnectors}
          hasGatewayHost={hasGatewayHost}
        />
      )}
    </main>
  );
}
