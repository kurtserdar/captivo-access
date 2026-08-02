import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { getSetupStatus } from "@/lib/dashboard/stats";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", VENDOR: "Vendor" };

export default async function DashboardPage() {
  const user = await requireUser();

  const head = (
    <div className="page-head">
      <div>
        <h1>Welcome, {user.name}</h1>
        <p>
          <span className="pill neutral">{ROLE_LABEL[user.role] ?? user.role}</span>
        </p>
      </div>
    </div>
  );

  if (user.role !== "ADMIN") {
    return (
      <main>
        {head}
        <div className="card">
          <p>
            See the apps you can reach and request new access under{" "}
            <Link href="/access">My access</Link>.
          </p>
        </div>
      </main>
    );
  }

  const s = await getSetupStatus();
  const steps = [
    {
      done: s.connectorsOnline >= 1,
      title: "Connect your network",
      hint: "Add a connector and run it inside your network so it comes online.",
      href: "/admin/connectors",
    },
    {
      done: s.sites >= 1,
      title: "Add an internal app",
      hint: "Define a Site for an app the connector can reach.",
      href: "/admin/sites",
    },
    {
      done: s.grants >= 1,
      title: "Grant someone access",
      hint: "Tie a user to a site — optionally time-boxed, approved, or scheduled.",
      href: "/admin/grants",
    },
  ];
  const allDone = steps.every((st) => st.done);
  const connectorsOffline = s.connectors >= 1 && s.connectorsOnline === 0;

  return (
    <main>
      {head}

      {s.pending >= 1 && (
        <p className="pill warn" style={{ marginBottom: "16px" }}>
          {s.pending} access request{s.pending === 1 ? "" : "s"} waiting for your review —{" "}
          <Link href="/admin/grants">review in Grants</Link>
        </p>
      )}

      {!allDone ? (
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
      ) : (
        <div className="card">
          <div className="card-head"><h2>Overview</h2></div>
          <p className="pill ok" style={{ marginBottom: "12px" }}>✓ You&apos;re set up</p>
          <div className="stat-row">
            <Link className="pill neutral" href="/admin/connectors">{s.connectorsOnline}/{s.connectors} connectors online</Link>
            <Link className="pill neutral" href="/admin/sites">{s.sites} sites</Link>
            <Link className="pill neutral" href="/admin/grants">{s.grants} grants</Link>
          </div>
        </div>
      )}

      <p className={`connector-health ${connectorsOffline ? "warn" : ""}`}>
        {connectorsOffline ? (
          <span className="pill warn">
            A connector is enrolled but not online — check the install command&apos;s{" "}
            <code>MANAGER_URL</code>/<code>DATAPLANE_URL</code> and that the container is running.
          </span>
        ) : (
          <span className="cell-sub">{s.connectorsOnline} of {s.connectors} connectors online.</span>
        )}
      </p>
    </main>
  );
}
