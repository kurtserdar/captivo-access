import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { evaluateAccess } from "@/lib/access/evaluate";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const siteId = typeof body.siteId === "string" ? body.siteId.trim() : "";
  if (!userId || !siteId) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const d = await evaluateAccess(userId, siteId, new Date());
  return NextResponse.json({ allow: d.allow, reason: d.reason });
}
