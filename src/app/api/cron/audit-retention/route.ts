import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function cronAuthorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Number(process.env.AUDIT_RETENTION_DAYS ?? "730");
  const retentionDays = Number.isFinite(days) && days >= 0 ? days : 730;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await db.auditEvent.deleteMany({ where: { timestamp: { lt: cutoff } } });
  return NextResponse.json({ deleted: result.count });
}
