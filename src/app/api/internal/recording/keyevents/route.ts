import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encryptBytes } from "@/lib/crypto";
import { recordingEnabled } from "@/lib/recording/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

interface KeyEventsBody {
  recordingKey?: string;
  events?: { atMs: number; kind: string; text: string; masked: boolean }[];
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!recordingEnabled()) return new NextResponse(null, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as KeyEventsBody;
  const key = body.recordingKey;
  const events = Array.isArray(body.events) ? body.events : [];
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
