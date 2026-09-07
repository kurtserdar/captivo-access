import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/roles";
import { resolveTenantByUser, withTenantFrom } from "@/lib/tenant/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

async function tenantFromReq(req: NextRequest): Promise<string | null> {
  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
  return resolveTenantByUser(typeof body.userId === "string" ? body.userId : "");
}

async function handler(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ allow: false });
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  return NextResponse.json({ allow: !!user && can(user.role, "read_console") });
}

export const POST = withTenantFrom(tenantFromReq)(handler);
