import { NextRequest, NextResponse } from "next/server";
import { evaluateAccess } from "@/lib/access/evaluate";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const siteId = typeof body.siteId === "string" ? body.siteId : "";
  if (!userId || !siteId) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const d = await evaluateAccess(userId, siteId, new Date());
  return NextResponse.json({ allow: d.allow, reason: d.reason });
}
