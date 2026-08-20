import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { assembleEvents } from "@/lib/recording/assemble";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "configure")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({ where: { id } });
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const chunks = await db.recordingChunk.findMany({ where: { recordingId: id }, orderBy: { seq: "asc" }, select: { seq: true, data: true } });
  const events = assembleEvents(chunks, rec.encrypted);

  return NextResponse.json({ id: rec.id, startedAt: rec.startedAt, events });
}
