import { requireCapability } from "@/lib/current-user";
import { getUpdateCheckConfig } from "@/lib/updates/update-check-config";
import { managerVersion } from "@/lib/version";
import { UpdatesForm } from "./updates-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Updates" };

export default async function AdminUpdatesPage() {
  await requireCapability("configure");
  const cfg = await getUpdateCheckConfig();

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
          currentVersion={managerVersion()}
          latestVersion={cfg?.latestVersion ?? null}
          lastCheckedAt={cfg?.lastCheckedAt ? cfg.lastCheckedAt.toISOString() : null}
          lastCheckOk={cfg?.lastCheckOk ?? null}
        />
      </div>
    </main>
  );
}
