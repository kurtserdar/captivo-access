import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { db } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant/context";
import { recordingEnabled } from "@/lib/recording/enabled";
import { serializeGuacChunk } from "@/lib/recording/assemble-guac";
import { resolveTenantBySite, withTenantFrom } from "@/lib/tenant/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

interface IngestGuacBody {
  recordingKey?: string;
  seq?: number;
  siteId?: string;
  userId?: string;
  host?: string;
  protocol?: string;
  data?: string; // base64 raw guac instruction bytes
}

async function tenantFromReq(req: NextRequest): Promise<string | null> {
  const body = (await req.clone().json().catch(() => ({}))) as IngestGuacBody;
  return resolveTenantBySite(body.siteId ?? "");
}

async function handler(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return NextResponse.json({ error: "not found" }, { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as IngestGuacBody;
    const recordingKey = body.recordingKey;
    if (!recordingKey || !body.data) return new NextResponse(null, { status: 204 });

    const raw = Buffer.from(body.data, "base64");
    if (raw.length === 0) return new NextResponse(null, { status: 204 });

    const stored = serializeGuacChunk(raw);
    const seq = typeof body.seq === "number" ? body.seq : 0;

    await db.$transaction(async (tx) => {
      const rec = await tx.sessionRecording.upsert({
        where: { tenantId_recordingKey: { tenantId: currentTenantId(), recordingKey } },
        create: {
          recordingKey,
          userId: body.userId ?? "",
          siteId: body.siteId ?? "",
          host: body.host ?? "",
          format: "GUAC",
          encrypted: true,
          protocol: body.protocol ?? null,
          eventCount: 1,
          bytes: stored.length,
          lastEventAt: new Date(),
        },
        update: {
          eventCount: { increment: 1 },
          bytes: { increment: stored.length },
          lastEventAt: new Date(),
        },
      });

      await tx.recordingChunk.create({
        data: { recordingId: rec.id, seq, data: new Uint8Array(stored) },
      });
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Best-effort: recording must never throw back to the data-plane.
    console.error("[recording/ingest-guac] failed to store chunk:", err);
    return new NextResponse(null, { status: 500 });
  }
}

export const POST = withTenantFrom(tenantFromReq)(handler);
