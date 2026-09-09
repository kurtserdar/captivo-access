import Link from "next/link";
import { withRequestTenant } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { platformSnapshot } from "@/lib/platform/overview";
import { listCustomDomains } from "@/lib/platform/custom-domains";
import { db } from "@/lib/db";
import { cronRuns } from "@/lib/platform/sql";
import { managerVersion } from "@/lib/version";
import { timeAgo } from "@/lib/format";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { HealthChips, SectionHead, StatCard } from "../../_shell/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs & provisioning" };

const JOBS = ["site-health", "audit-retention", "recording-retention", "audit-anchor"] as const;
const CADENCE: Record<string, number> = { "site-health": 20 * 60_000, "audit-retention": 26 * 3600_000, "recording-retention": 26 * 3600_000, "audit-anchor": 26 * 3600_000, "platform-ops": 26 * 3600_000 };

export default async function JobsPage() {
  const { snap, domains, platformRuns, runs } = await withRequestTenant(async () => {
    await requirePlatformAdmin();
    const [snap, domains, platformRuns, runs] = await Promise.all([platformSnapshot(), listCustomDomains().catch(() => []), db.cronRun.findMany({ select: { job: true, ranAt: true } }), cronRuns()]);
    return { snap, domains, platformRuns, runs };
  });
  const live = snap.tenants.filter((t) => !t.deletedAt);
  const lastRun = (tenantId: string, job: string): Date | null => {
    const r = runs.find((x) => x.tenantId === tenantId && x.job === job);
    return r ? new Date(r.ranAt) : null;
  };
  const now = Date.now();
  const stalePill = (d: Date | null, job: string) => {
    if (!d) return <span className="pill neutral">never</span>;
    const age = now - d.getTime();
    return <span className={`pill ${age > (CADENCE[job] ?? 26 * 3600_000) ? "warn" : "ok"}`} title={d.toISOString()}>{timeAgo(d)}</span>;
  };
  const ops = platformRuns.find((r) => r.job === "platform-ops")?.ranAt ?? null;
  const heartbeat = live.map((t) => t.cron.heartbeatAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const provisioningProblems = live.filter((t) => t.problems.length > 0).length;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Jobs &amp; provisioning</h1>
          <p>Background jobs per tenant, the platform-level maintenance job, and whether each tenant&apos;s DNS namespace and certificate are in place.</p>
        </div>
      </div>
      <div className="stat-grid">
        <StatCard k="Scheduler heartbeat" v={heartbeat ? timeAgo(heartbeat) : "never"} sub="latest site-health run across tenants" tone={heartbeat && now - heartbeat.getTime() < CADENCE["site-health"] ? "ok" : "danger"} />
        <StatCard k="Platform ops" v={ops ? timeAgo(ops) : "never"} sub="purge, trial expiry, ops digest (daily)" tone={ops && now - ops.getTime() < CADENCE["platform-ops"] ? "ok" : "warn"} />
        <StatCard k="Provisioning problems" v={provisioningProblems} sub={`${live.length} tenants probed`} tone={provisioningProblems ? "danger" : "ok"} />
        <StatCard k="Custom domains" v={domains.length} sub={`${domains.filter((d) => !d.verifiedAt).length} unverified`} />
        <StatCard k="Manager" v={managerVersion()} sub="running version" />
      </div>

      <div className="card">
        <SectionHead title="Tenant namespaces" sub="Wildcard DNS (*.<slug>.<console domain>) must point at this server and the shared certificate must cover it. Probed live, cached for a minute." />
        {live.length === 0 ? <div className="empty">No tenants.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Tenant</th><th>Probe host</th><th>Resolves to</th><th>Health</th><th>Certificate expires</th><th>Problems</th></tr></thead><tbody>
            {live.map((t) => <tr key={t.id}><td><Link href={`/platform/tenants/${t.id}`} className="link-button">{t.name}</Link><div className="cell-sub">{t.status}</div></td><td className="cell-sub">{t.health?.host ?? "—"}</td><td className="cell-sub">{t.health?.dnsAddresses.join(", ") || "—"}</td><td><HealthChips h={t.health} /></td><td className="cell-sub">{t.health?.certExpiresAt ? <><LocalTime iso={t.health.certExpiresAt.toISOString()} mode="date" /> ({t.health.certDaysLeft}d)</> : "—"}</td><td className="cell-sub" style={{ whiteSpace: "normal" }}>{t.problems.length ? t.problems.join(" · ") : <span className="pill ok">none</span>}</td></tr>)}
          </tbody></table></div>
        )}
      </div>

      <div className="card">
        <SectionHead title="Background jobs" sub="Last run per tenant. site-health every 5 minutes is the scheduler heartbeat; the others run daily." />
        {live.length === 0 ? <div className="empty">No tenants.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Tenant</th>{JOBS.map((j) => <th key={j}>{j}</th>)}</tr></thead><tbody>
            {live.map((t) => <tr key={t.id}><td><Link href={`/platform/tenants/${t.id}`} className="link-button">{t.name}</Link></td>{JOBS.map((j) => <td key={j}>{stalePill(lastRun(t.id, j), j)}</td>)}</tr>)}
          </tbody></table></div>
        )}
      </div>

      <div className="card">
        <SectionHead title="Custom domains" sub="Tenant-owned domains serving a transparent resource. Certificates are issued by the host provisioning job once verified." />
        {domains.length === 0 ? <div className="empty">No custom domains.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Domain</th><th>Tenant</th><th>Resource</th><th>Verified</th><th>Health</th></tr></thead><tbody>
            {domains.map((d) => <tr key={d.siteId}><td>{d.hostname}</td><td><Link href={`/platform/tenants/${d.tenantId}`} className="link-button">{d.tenantName}</Link></td><td className="cell-sub">{d.siteName}</td><td>{d.verifiedAt ? <span className="pill ok">verified</span> : <span className="pill warn">unverified</span>}</td><td>{d.probeOk === null ? <span className="pill neutral">unknown</span> : <span className={`pill ${d.probeOk ? "ok" : "danger"}`}>{d.probeOk ? "up" : "down"}</span>}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
    </section>
  );
}
