import { requireCapability } from "@/lib/current-user";
import { getSessionPolicy } from "@/lib/policy/session-policy";
import { getPlatformSettings, resolvedRecordingConsentRequired } from "@/lib/settings/platform";
import { SessionPolicyForm } from "./session-policy-form";
import { PlatformSettingsForm } from "./platform-settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Policy" };

export default async function AdminPolicyPage() {
  await requireCapability("configure");
  const [policy, platform, consentEffective] = await Promise.all([
    getSessionPolicy(),
    getPlatformSettings(),
    resolvedRecordingConsentRequired(),
  ]);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Policy</h1>
          <p>Organization-wide controls. Applied everywhere — the console and vendor sessions. These settings live in
            the database and can also be set from the environment; the value here always wins.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Session controls</h2></div>
        <SessionPolicyForm initial={policy} />
      </div>

      <div className="card">
        <div className="card-head"><h2>Grants, retention, network &amp; notifications</h2></div>
        <PlatformSettingsForm initial={platform} consentEffective={consentEffective} />
      </div>
    </main>
  );
}
