import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { managerVersion } from "@/lib/version";
import { isConnectorOutdated } from "@/lib/updates/semver";
import { getSetupStatus } from "@/lib/dashboard/stats";
import { isConsoleUser, ROLE_LABELS } from "@/lib/auth/roles";
import { getConsoleData } from "@/lib/console/data";
import { SecurityConsole } from "./_console/security-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function DashboardPage() {
  const user = await requireUser();

  const head = (
    <div className="page-head">
      <div>
        <h1>Welcome, {user.name}</h1>
        <p><span className="pill neutral">{ROLE_LABELS[user.role] ?? user.role}</span></p>
      </div>
    </div>
  );

  if (!isConsoleUser(user.role)) {
    redirect("/access");
  }

  if (user.role !== "ADMIN") {
    return (
      <main>
        {head}
        <div className="card">
          <p>Use the navigation above to review access grants and the audit log.</p>
        </div>
      </main>
    );
  }

  const setup = await getSetupStatus();
  const steps = [
    { done: setup.connectorsOnline >= 1, title: "Connect your network", hint: "Add a connector and run it inside your network so it comes online.", href: "/admin/connectors" },
    { done: setup.sites >= 1, title: "Add an internal app", hint: "Define a Resource for an app the connector can reach.", href: "/admin/sites" },
    { done: setup.grants >= 1, title: "Grant someone access", hint: "Tie a user to a resource — optionally time-boxed, approved, or scheduled.", href: "/admin/grants" },
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

  const conns = await db.connector.findMany({ where: { status: { not: "REVOKED" } }, select: { version: true } });
  const mgr = managerVersion();
  const outdated = conns.filter((c) => isConnectorOutdated(c.version, mgr)).length;
  const data = await getConsoleData();

  return (
    <main>
      {head}
      {outdated > 0 && (
        <div className="notice">
          {outdated} connector{outdated === 1 ? "" : "s"} {outdated === 1 ? "is" : "are"} older than the manager (v{mgr}).{" "}
          <Link href="/admin/connectors">Review →</Link>
        </div>
      )}
      <SecurityConsole data={data} />
    </main>
  );
}
