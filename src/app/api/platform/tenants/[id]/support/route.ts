import { NextResponse } from "next/server";
import { tenantRoute } from "@/lib/platform/route";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import { sha256, generateToken } from "@/lib/auth/tokens";
import { consoleDomain } from "@/lib/tenant/console-domain";
import { recordPlatformAction } from "@/lib/platform/audit";
import { HANDOFF_TTL_MS } from "@/lib/support/session";

export const dynamic = "force-dynamic";

// Break-glass: mint a one-time handoff for the tenant host. The tenant host's
// /api/support/handoff turns it into a 1-hour support session there.
export const POST = tenantRoute(async ({ req, actor, tenant, ip }) => {
  if (tenant.deletedAt || tenant.status !== "ACTIVE") return NextResponse.json({ error: "tenant_inactive" }, { status: 409 });
  const b = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return NextResponse.json({ error: "reason_required" }, { status: 400 });
  const domain = consoleDomain();
  if (!domain) return NextResponse.json({ error: "no_console_domain" }, { status: 500 });
  const token = generateToken();
  // Created INSIDE the target tenant so the tenant-host route can read it under RLS.
  await withTenant(tenant.id, () =>
    db.supportHandoff.create({ data: { tokenHash: sha256(token), actorId: actor.id, actorEmail: actor.email ?? "", reason, expiresAt: new Date(Date.now() + HANDOFF_TTL_MS) } }),
  );
  await recordPlatformAction({ actor, action: "platform.support.access", tenant, clientIp: ip, summary: `Support access to ${tenant.slug}: ${reason}`, metadata: { reason } });
  return NextResponse.json({ ok: true, url: `https://${tenant.slug}.${domain}/api/support/handoff?t=${encodeURIComponent(token)}` });
});
