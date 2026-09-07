import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/tenant/request";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { createTenant, PlatformError } from "@/lib/platform/tenants";

async function handler(req: NextRequest) {
  await requirePlatformAdmin();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name : "";
  const slug = typeof body.slug === "string" ? body.slug.toLowerCase().trim() : "";
  const adminEmail = typeof body.adminEmail === "string" ? body.adminEmail : "";
  try {
    const result = await createTenant({ name, slug, adminEmail });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PlatformError) return NextResponse.json({ error: e.code }, { status: 400 });
    throw e;
  }
}

export const POST = withTenantRoute(handler);
