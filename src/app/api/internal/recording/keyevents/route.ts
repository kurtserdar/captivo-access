import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { contentLengthExceeds } from "@/lib/request-limits";
import { db } from "@/lib/db";
import { encryptBytes } from "@/lib/crypto";
import { recordingEnabled } from "@/lib/recording/enabled";
import { requireDataplaneSecret, resolveTenantByRecordingKey, withTenantFrom } from "@/lib/tenant/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

interface KeyEventsBody {
  recordingKey?: string;
  events?: { atMs: number; kind: string; text: string; masked: boolean }[];
}

async function tenantFromReq(req: NextRequest): Promise<string | null> {
  const body = (await req.clone().json().catch(() => ({}))) as KeyEventsBody;
  return resolveTenantByRecordingKey(body.recordingKey ?? "");
}

async function handler(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return new NextResponse(null, { status: 403 });
  if (contentLengthExceeds(req, 1 << 20)) return new NextResponse(null, { status: 413 });

  const body = (await req.json().catch(() => ({}))) as KeyEventsBody;
  const key = body.recordingKey;
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 2000);
  if (!key || events.length === 0) return new NextResponse(null, { status: 204 });

  const base = await db.sessionKeyEvent.count({ where: { recordingKey: key } });
  await db.sessionKeyEvent.createMany({
    data: events.map((e, i) => ({
      recordingKey: key,
      seq: base + i,
      atMs: Math.max(0, Math.round(e.atMs)),
      kind: e.kind === "command" ? "command" : "text",
      data: new Uint8Array(encryptBytes(Buffer.from(e.text, "utf8"))),
      masked: !!e.masked,
    })),
  });
  return new NextResponse(null, { status: 204 });
}

export const POST = requireDataplaneSecret(withTenantFrom(tenantFromReq)(handler));
