import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { decryptBytes } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({ where: { id }, select: { recordingKey: true } });
  if (!rec) return NextResponse.json([]);

  const rows = await db.sessionKeyEvent.findMany({
    where: { recordingKey: rec.recordingKey },
    orderBy: { seq: "asc" },
    select: { atMs: true, kind: true, data: true, masked: true },
  });
  const events = rows.map((r) => ({
    atMs: r.atMs,
    kind: r.kind,
    masked: r.masked,
    text: r.masked
      ? "••••"
      : (() => {
          try {
            return decryptBytes(Buffer.from(r.data)).toString("utf8");
          } catch {
            return "";
          }
        })(),
  }));
  return NextResponse.json(events);
}
