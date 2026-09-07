import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { setTenantStatus } from "@/lib/platform/tenants";

async function handler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = body.status === "SUSPENDED" ? "SUSPENDED" : body.status === "ACTIVE" ? "ACTIVE" : null;
  if (!status) return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  await setTenantStatus(id, status);
  return NextResponse.json({ ok: true });
}

export const POST = withTenantRoute(handler);
