import { recordAdminAction, type AdminActor } from "@/lib/audit/admin";
import { withTenant } from "@/lib/tenant/scope";

// Every platform action lands in the PLATFORM tenant's admin chain (who did what
// to which tenant) and — when it touches a tenant — in THAT tenant's own admin
// chain too, so the tenant's admins can see the platform acted on their
// account. Best-effort like recordAdminAction itself.
export async function recordPlatformAction(input: {
  actor: AdminActor;
  action: string; // "platform.tenant.create", "platform.support.access", ...
  tenant?: { id: string; slug: string } | null;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  clientIp?: string | null;
}): Promise<void> {
  const meta = { ...(input.metadata ?? {}), ...(input.tenant ? { tenantId: input.tenant.id, tenantSlug: input.tenant.slug } : {}) };
  await recordAdminAction({
    actor: input.actor,
    action: input.action,
    targetType: input.targetType ?? (input.tenant ? "tenant" : undefined),
    targetId: input.targetId ?? input.tenant?.id,
    summary: input.summary,
    metadata: meta,
    clientIp: input.clientIp,
  });
  if (input.tenant) {
    const t = input.tenant;
    await withTenant(t.id, () =>
      recordAdminAction({
        actor: { id: input.actor.id, email: input.actor.email },
        action: input.action,
        targetType: input.targetType ?? "tenant",
        targetId: input.targetId ?? t.id,
        summary: `[Captivo platform] ${input.summary}`,
        metadata: { ...(input.metadata ?? {}), platformActor: input.actor.email },
        clientIp: input.clientIp,
      }),
    ).catch(() => {});
  }
}
