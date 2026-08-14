import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

interface IngestVideoBody {
  recordingKey?: string;
  seq?: number;
  siteId?: string;
  userId?: string;
  host?: string;
  data?: string; // base64 raw WebM bytes
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return NextResponse.json({ error: "not found" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as IngestVideoBody;
    const recordingKey = body.recordingKey;
    if (!recordingKey || !body.data) return new NextResponse(null, { status: 204 });

    const raw = Buffer.from(body.data, "base64");
    if (raw.length === 0) return new NextResponse(null, { status: 204 });
    const seq = typeof body.seq === "number" ? body.seq : 0;

    await db.$transaction(async (tx) => {
      const rec = await tx.sessionRecording.upsert({
        where: { recordingKey },
        create: {
          recordingKey,
          userId: body.userId ?? "",
          siteId: body.siteId ?? "",
          host: body.host ?? "",
          format: "VIDEO",
          encrypted: false,
          protocol: "kasm",
          eventCount: 1,
          bytes: raw.length,
          lastEventAt: new Date(),
        },
        update: {
          eventCount: { increment: 1 },
          bytes: { increment: raw.length },
          lastEventAt: new Date(),
        },
      });
      await tx.recordingChunk.create({
        data: { recordingId: rec.id, seq, data: new Uint8Array(raw) },
      });
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Best-effort: recording must never throw back to the data-plane.
    console.error("[recording/ingest-video] failed to store chunk:", err);
    return new NextResponse(null, { status: 500 });
  }
}
