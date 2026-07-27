import { requireUser } from "@/lib/current-user";
import { listUserGrants } from "@/lib/access/grants";
import { classifyGrant } from "@/lib/access/evaluate";

export const dynamic = "force-dynamic";

function formatWindow(startsAt: Date | null, endsAt: Date | null): string {
  const start = startsAt ? startsAt.toLocaleString("en-US") : "Immediately";
  const end = endsAt ? endsAt.toLocaleString("en-US") : "Permanent";
  return `${start} → ${end}`;
}

type Grant = Awaited<ReturnType<typeof listUserGrants>>[number];

function GrantTable({ grants, badge }: { grants: Grant[]; badge: React.ReactNode }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Site</th>
          <th>Window</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {grants.map((g) => (
          <tr key={g.id}>
            <td>{g.site.name}</td>
            <td>{formatWindow(g.startsAt, g.endsAt)}</td>
            <td>{badge}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AccessPage() {
  const user = await requireUser();
  const grants = await listUserGrants(user.id);
  const now = new Date();

  const active: Grant[] = [];
  const upcoming: Grant[] = [];
  for (const g of grants) {
    const reason = classifyGrant(g, now);
    if (reason === "allow") active.push(g);
    else if (reason === "not_yet") upcoming.push(g);
    // Expired, revoked, and pending_approval grants are not shown here.
  }

  return (
    <main>
      <h1>My access</h1>
      <p>Sites you have been granted access to, and when that access applies.</p>

      {active.length === 0 && upcoming.length === 0 ? (
        <p>You do not have any active access right now.</p>
      ) : (
        <>
          <h2>Active</h2>
          {active.length === 0 ? (
            <p>No active grants.</p>
          ) : (
            <GrantTable grants={active} badge={<span className="result-badge allow">Active</span>} />
          )}

          <h2>Upcoming</h2>
          {upcoming.length === 0 ? (
            <p>No upcoming grants.</p>
          ) : (
            <GrantTable grants={upcoming} badge={<span className="badge">Upcoming</span>} />
          )}
        </>
      )}
    </main>
  );
}
