import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { getSetupStatus, getDashboardStats, getSiteHealth, getRecentActivity } from "@/lib/dashboard/stats";
import { StatCards } from "./_dashboard/stat-cards";
import { SiteHealthPanel } from "./_dashboard/site-health-panel";
import { RecentActivityPanel } from "./_dashboard/recent-activity-panel";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", VENDOR: "Vendor" };

export default async function DashboardPage() {
  const user = await requireUser();

  const head = (
    <div className="page-head">
      <div>
        <h1>Welcome, {user.name}</h1>
        <p><span className="pill neutral">{ROLE_LABEL[user.role] ?? user.role}</span></p>
      </div>
    </div>
  );

  if (user.role !== "ADMIN") {
    const activeGrants = await db.accessGrant.count({ where: { userId: user.id, status: "ACTIVE" } });
    return (
      <main>
        {head}
        <div className="card">
          <p>
            You have <strong>{activeGrants}</strong> active access grant{activeGrants === 1 ? "" : "s"}. See the apps
            you can reach and request new access under <Link href="/access">My access</Link>.
          </p>
        </div>
      </main>
    );
  }

  const setup = await getSetupStatus();
  const steps = [
    { done: setup.connectorsOnline >= 1, title: "Connect your network", hint: "Add a connector and run it inside your network so it comes online.", href: "/admin/connectors" },
    { done: setup.sites >= 1, title: "Add an internal app", hint: "Define a Site for an app the connector can reach.", href: "/admin/sites" },
    { done: setup.grants >= 1, title: "Grant someone access", hint: "Tie a user to a site — optionally time-boxed, approved, or scheduled.", href: "/admin/grants" },
  ];
  const allDone = steps.every((st) => st.done);

  if (!allDone) {
    return (
      <main>
        {head}
        <div className="card">
          <div className="card-head"><h2>Getting started</h2></div>
          <ol className="checklist">
            {steps.map((st) => (
              <li key={st.href} className={st.done ? "done" : ""}>
                <span className="check" aria-hidden="true">{st.done ? "✓" : "○"}</span>
                <div>
                  <div className="ct">{st.title}</div>
                  <div className="ch">{st.hint}</div>
                </div>
                {!st.done && <Link className="btn sm" href={st.href}>Go →</Link>}
              </li>
            ))}
          </ol>
        </div>
      </main>
    );
  }

  const [stats, siteHealth, activity] = await Promise.all([getDashboardStats(), getSiteHealth(), getRecentActivity()]);

  return (
    <main>
      {head}
      <StatCards s={stats} />
      <div className="dash-cols">
        <SiteHealthPanel sites={siteHealth} />
        <RecentActivityPanel events={activity} />
      </div>
    </main>
  );
}
