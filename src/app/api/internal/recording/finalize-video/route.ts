import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { db } from "@/lib/db";
import { encryptBytes } from "@/lib/crypto";
import { recordingEnabled } from "@/lib/recording/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

interface FinalizeBody {
  recordingKey?: string;
  seq?: number;
  data?: string; // base64 seekable WebM bytes
}

// Replaces an isolated recording's interim (live) chunks with the finalized, seekable
// file streamed at clean session end. On the first chunk (seq 0) the old chunks are
// dropped; later chunks append. The live relay has already drained before this is
// called, so no interim chunk can race in.
export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return NextResponse.json({ error: "not found" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as FinalizeBody;
    const recordingKey = body.recordingKey;
    if (!recordingKey || !body.data) return new NextResponse(null, { status: 204 });
    const raw = Buffer.from(body.data, "base64");
    if (raw.length === 0) return new NextResponse(null, { status: 204 });
    const seq = typeof body.seq === "number" ? body.seq : 0;
    // The interim recording was created encrypted (encrypted:true). The finalized
    // chunks REPLACE those interim chunks, so they must be encrypted the same way or
    // the read path (which decrypts when encrypted:true) fails to authenticate them.
    // WebM is already codec-compressed, so no gzip — mirror ingest-video exactly.
    const data = encryptBytes(raw);

    await db.$transaction(async (tx) => {
      const rec = await tx.sessionRecording.findUnique({ where: { recordingKey } });
      if (!rec) return; // no interim recording to finalize — nothing to do
      if (seq === 0) {
        await tx.recordingChunk.deleteMany({ where: { recordingId: rec.id } });
        await tx.sessionRecording.update({
          where: { id: rec.id },
          data: { bytes: data.length, eventCount: 1, encrypted: true, lastEventAt: new Date() },
        });
      } else {
        await tx.sessionRecording.update({
          where: { id: rec.id },
          data: { bytes: { increment: data.length }, eventCount: { increment: 1 }, lastEventAt: new Date() },
        });
      }
      await tx.recordingChunk.create({ data: { recordingId: rec.id, seq, data: new Uint8Array(data) } });
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[recording/finalize-video] failed to store finalized chunk:", err);
    return new NextResponse(null, { status: 500 });
  }
}
