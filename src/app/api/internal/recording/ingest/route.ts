import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { encryptBytes } from "@/lib/crypto";
import { recordingEnabled } from "@/lib/recording/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

interface IngestBody {
  userId?: string;
  siteId?: string;
  host?: string;
  recordingKey?: string;
  seq?: number;
  events?: unknown[];
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return NextResponse.json({ error: "not found" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as IngestBody;
    const recordingKey = body.recordingKey;
    const events = Array.isArray(body.events) ? body.events : [];
    if (!recordingKey || events.length === 0) return new NextResponse(null, { status: 204 });

    const seq = typeof body.seq === "number" ? body.seq : 0;
    // Encrypt at rest (AES-256-GCM over the gzipped events), same as GUAC recordings.
    const data = encryptBytes(gzipSync(Buffer.from(JSON.stringify(events))));

    await db.$transaction(async (tx) => {
      const recording = await tx.sessionRecording.upsert({
        where: { recordingKey },
        create: {
          recordingKey,
          userId: body.userId ?? "",
          siteId: body.siteId ?? "",
          host: body.host ?? "",
          eventCount: events.length,
          bytes: data.length,
          encrypted: true,
          lastEventAt: new Date(),
        },
        update: {
          eventCount: { increment: events.length },
          bytes: { increment: data.length },
          lastEventAt: new Date(),
        },
      });

      await tx.recordingChunk.create({
        data: {
          recordingId: recording.id,
          seq,
          data: new Uint8Array(data),
        },
      });
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Best-effort: recording must never throw — log server-side and return a
    // generic response so nothing internal leaks to the data-plane caller.
    console.error("[recording/ingest] failed to store batch:", err);
    return new NextResponse(null, { status: 500 });
  }
}
