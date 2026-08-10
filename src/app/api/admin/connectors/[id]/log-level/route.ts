import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { pushConnectorPolicy } from "@/lib/connector/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVELS = ["debug", "info", "warn", "error"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const level = typeof body.logLevel === "string" && LEVELS.includes(body.logLevel) ? body.logLevel : "info";

  const updated = await db.connector.updateMany({ where: { id }, data: { logLevel: level } });
  if (updated.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const push = await pushConnectorPolicy(id);
  return NextResponse.json({ ok: true, live: push.ok });
}
