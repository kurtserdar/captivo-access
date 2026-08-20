import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { appendAuditEvents, type AuditInput } from "@/lib/audit/append";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { events?: AuditInput[] };
  const events = Array.isArray(body.events) ? body.events : [];
  const inserted = await appendAuditEvents(events);
  return NextResponse.json({ inserted });
}
