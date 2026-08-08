import { requireAdmin } from "@/lib/current-user";
import { db } from "@/lib/db";
import Link from "next/link";
import { LocalTime } from "@/app/(app)/_shell/local-time";
import { RecordingPlayer } from "./recording-player";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recording" };

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({ where: { id } });
  if (!rec) {
    return <main><div className="empty">Recording not found.</div></main>;
  }
  const user = await db.user.findUnique({ where: { id: rec.userId }, select: { name: true, email: true } });
  const site = await db.site.findUnique({ where: { id: rec.siteId }, select: { name: true } });
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Recording</h1>
          <p>{user?.name ?? "—"} · {site?.name ?? rec.host} · <LocalTime iso={rec.startedAt.toISOString()} /></p>
        </div>
        <Link href="/admin/recordings" className="btn sm">Back to recordings</Link>
      </div>
      <div className="card">
        <RecordingPlayer id={rec.id} />
      </div>
    </main>
  );
}
