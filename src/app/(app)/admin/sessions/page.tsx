import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import { currentSessionId } from "@/lib/auth/session";
import { SessionsTable, type SessionRow } from "./sessions-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sessions" };

export default async function AdminSessionsPage() {
  await requireAdmin();

  const [sessions, currentId] = await Promise.all([
    db.session.findMany({
      where: { expiresAt: { gt: new Date() } },
      select: {
        id: true,
        ip: true,
        userAgent: true,
        lastSeenAt: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: { lastSeenAt: "desc" },
    }),
    currentSessionId(),
  ]);

  const rows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    ip: s.ip,
    userAgent: s.userAgent,
    lastSeenAt: s.lastSeenAt.toISOString(),
    userName: s.user.name,
    userEmail: s.user.email,
  }));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p>All currently active (non-expired) sessions.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No active sessions.</div>
      ) : (
        <SessionsTable sessions={rows} currentSessionId={currentId} />
      )}
    </main>
  );
}
