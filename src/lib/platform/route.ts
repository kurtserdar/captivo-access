import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { getTenant, PlatformError, type PlatformTenant } from "@/lib/platform/tenants";
import { clientIp } from "@/lib/request-ip";
import type { AdminActor } from "@/lib/audit/admin";

export interface TenantRouteCtx { req: NextRequest; actor: AdminActor; tenant: PlatformTenant; ip: string | null }

// Route wrapper for /api/platform/tenants/[id]/*: platform-admin gate, tenant
// lookup (404 when unknown), PlatformError → 400 {error: code}.
export function tenantRoute(handler: (ctx: TenantRouteCtx) => Promise<Response>) {
  return withTenantRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const admin = await requirePlatformAdmin();
    const { id } = await params;
    const tenant = await getTenant(id);
    if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      return await handler({ req, actor: { id: admin.id, email: admin.email }, tenant, ip: clientIp(req.headers) ?? null });
    } catch (e) {
      if (e instanceof PlatformError) return NextResponse.json({ error: e.code }, { status: 400 });
      throw e;
    }
  });
}

// Same gate for platform-wide routes (no tenant in the path).
export function platformRoute(handler: (ctx: { req: NextRequest; actor: AdminActor; ip: string | null }) => Promise<Response>) {
  return withTenantRoute(async (req: NextRequest) => {
    const admin = await requirePlatformAdmin();
    try {
      return await handler({ req, actor: { id: admin.id, email: admin.email }, ip: clientIp(req.headers) ?? null });
    } catch (e) {
      if (e instanceof PlatformError) return NextResponse.json({ error: e.code }, { status: 400 });
      throw e;
    }
  });
}
