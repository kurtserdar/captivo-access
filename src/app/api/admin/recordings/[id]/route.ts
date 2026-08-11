import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { appendAuditEvents } from "@/lib/audit/append";
import { clientIp } from "@/lib/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({
    where: { id },
    select: { id: true, siteId: true, userId: true, host: true, startedAt: true, eventCount: true, bytes: true },
  });
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Resolve the vendor's email for a human-readable audit reason.
  const vendor = await db.user.findUnique({ where: { id: rec.userId }, select: { email: true } });

  // RecordingChunk cascades on delete of the parent SessionRecording.
  await db.sessionRecording.delete({ where: { id } });

  // Audit the deletion in the tamper-evident chain. Best-effort: the delete is
  // the primary action, so an audit failure is logged but does not fail the call.
  try {
    await appendAuditEvents([
      {
        userId: admin.id,
        siteId: rec.siteId,
        host: "manager",
        method: "DELETE",
        path: `/admin/recordings/${id}`,
        status: 200,
        decision: "ALLOW",
        reason: `Deleted session recording (vendor ${vendor?.email ?? rec.userId}, ${rec.eventCount} events, ${rec.bytes} bytes, started ${rec.startedAt.toISOString()})`,
        clientIp: clientIp(req.headers),
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
    ]);
  } catch (err) {
    console.error("[recordings/delete] audit append failed:", err);
  }

  return NextResponse.json({ ok: true });
}
