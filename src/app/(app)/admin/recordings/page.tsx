import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import Link from "next/link";
import { LocalTime } from "@/app/(app)/_shell/local-time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recordings" };

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function duration(a: Date, b: Date): string {
  const s = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function AdminRecordingsPage() {
  await requireAdmin();
  const recs = await db.sessionRecording.findMany({ orderBy: { startedAt: "desc" }, take: 100 });
  const userIds = [...new Set(recs.map((r) => r.userId))];
  const siteIds = [...new Set(recs.map((r) => r.siteId))];
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]));
  const sites = new Map((await db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } })).map((s) => [s.id, s]));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Recordings</h1>
          <p>Replay captured vendor sessions on recorded sites.</p>
        </div>
      </div>
      {recs.length === 0 ? (
        <div className="empty">No recordings yet. Enable recording on a site to capture sessions.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Started</th><th>User</th><th>Site</th><th>Duration</th><th>Events</th><th>Size</th><th></th></tr></thead>
            <tbody>
              {recs.map((r) => {
                const u = users.get(r.userId);
                const s = sites.get(r.siteId);
                return (
                  <tr key={r.id}>
                    <td className="cell-sub"><LocalTime iso={r.startedAt.toISOString()} /></td>
                    <td>{u?.name ?? "—"}{u?.email && <div className="cell-sub">{u.email}</div>}</td>
                    <td>{s?.name ?? r.host}</td>
                    <td className="cell-sub">{duration(r.startedAt, r.lastEventAt)}</td>
                    <td className="cell-sub">{r.eventCount}</td>
                    <td className="cell-sub">{humanBytes(r.bytes)}</td>
                    <td><Link href={`/admin/recordings/${r.id}`} className="btn sm">Watch</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
