import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { saveSessionPolicy } from "@/lib/policy/session-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  await saveSessionPolicy({
    idleTimeoutMinutes: toInt(body.idleTimeoutMinutes),
    maxSessionHours: toInt(body.maxSessionHours),
    maxConcurrentPerUser: toInt(body.maxConcurrentPerUser),
  });
  return NextResponse.json({ ok: true });
}
