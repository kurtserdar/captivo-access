import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { updateTenant } from "@/lib/platform/tenants";
import { recordPlatformAction } from "@/lib/platform/audit";

export const dynamic = "force-dynamic";

// Edit a tenant's name, plan, trial end, limits, capabilities and internal notes.
export const PATCH = tenantRoute(async ({ req, actor, tenant, ip }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const trialRaw = typeof b.trialEndsAt === "string" && b.trialEndsAt ? new Date(b.trialEndsAt) : null;
  await updateTenant(tenant.id, {
    name: typeof b.name === "string" ? b.name : tenant.name,
    plan: typeof b.plan === "string" ? b.plan : tenant.plan,
    trialEndsAt: trialRaw,
    limits: b.limits,
    capabilities: b.capabilities,
    notes: typeof b.notes === "string" ? b.notes : tenant.notes,
  });
  await recordPlatformAction({
    actor, action: "platform.tenant.update", tenant, clientIp: ip,
    summary: `Updated tenant ${tenant.slug} (plan ${typeof b.plan === "string" ? b.plan : tenant.plan})`,
    metadata: { plan: b.plan ?? null, limits: b.limits ?? null, capabilities: b.capabilities ?? null, trialEndsAt: trialRaw?.toISOString() ?? null },
  });
  return NextResponse.json({ ok: true });
});
