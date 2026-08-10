import { requireCapability } from "@/lib/current-user";
import { getSessionPolicy } from "@/lib/policy/session-policy";
import { getPlatformSettings, resolvedRecordingConsentRequired } from "@/lib/settings/platform";
import { cronHealth, type CronJob } from "@/lib/cron/heartbeat";
import { SessionPolicyForm } from "./session-policy-form";
import { PlatformSettingsForm } from "./platform-settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Policy" };

const JOB_LABEL: Record<CronJob, string> = {
  "site-health": "Site health",
  "audit-retention": "Audit log retention",
  "recording-retention": "Recording retention",
};

export default async function AdminPolicyPage() {
  await requireCapability("configure");
  const [policy, platform, consentEffective, cron] = await Promise.all([
    getSessionPolicy(),
    getPlatformSettings(),
    resolvedRecordingConsentRequired(),
    cronHealth(),
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

      {cron.stale.length > 0 && (
        <div className={`notice ${cron.anyRun ? "warn" : ""}`} role="alert">
          {cron.anyRun ? (
            <>
              <b>Some scheduled jobs look stopped:</b>{" "}
              {cron.stale.map((s) => JOB_LABEL[s.job]).join(", ")}. The settings that rely on them won&apos;t take
              effect until they run again — check the cron on your server (see the install docs).
            </>
          ) : (
            <>
              <b>Background jobs haven&apos;t run yet.</b> If you deployed with <code>deploy/setup.sh</code> they&apos;re
              already scheduled and will start shortly. Otherwise, schedule the cron jobs (retention &amp; health) on
              your server — see the install docs — or these settings won&apos;t take effect.
            </>
          )}
        </div>
      )}

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
