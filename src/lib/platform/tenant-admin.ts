// Per-tenant reads and actions for the platform console. Everything runs INSIDE
// withTenant(id): RLS, the insert trigger and the tenant's own audit chain apply
// exactly as if the tenant's admin had acted.
import { db } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import { createInvite } from "@/lib/auth/invite";
import { inviteEmail } from "@/lib/email/templates";
import { sendMail } from "@/lib/email/mailer";
import { chainKey } from "@/lib/audit/chain-key";
import { verifyAdminChain, type AdminStored } from "@/lib/audit/admin-chain";
import { getPlatformSettings } from "@/lib/settings/platform";
import { consoleDomain } from "@/lib/tenant/console-domain";
import { PlatformError } from "@/lib/platform/tenants";

export interface TenantOverview {
  users: { id: string; email: string; name: string; role: string; status: string; createdAt: Date; directoryManaged: boolean; sessions: number; passkeys: number }[];
  sites: { id: string; name: string; hostname: string | null; accessMode: string; customDomain: boolean; probeOk: boolean | null; probedAt: Date | null; recordSessions: boolean; connectorName: string }[];
  connectors: { id: string; name: string; status: string; lastSeenAt: Date | null; version: string | null; remoteAddr: string | null; sites: number }[];
  grants: { total: number; active: number; pending: number; revoked: number; denied: number; recent: { id: string; user: string; site: string; status: string; requiresApproval: boolean; approvedAt: Date | null; endsAt: Date | null; createdAt: Date }[] };
  invites: { id: string; email: string; role: string; expiresAt: Date; usedAt: Date | null; createdAt: Date }[];
  settings: Awaited<ReturnType<typeof getPlatformSettings>>;
  smtp: { enabled: boolean; host: string | null; lastVerifiedOk: boolean | null } | null;
  sso: { enabled: boolean; issuer: string | null } | null;
  recordings: { count: number; bytes: number; oldest: Date | null };
  cronRuns: { job: string; ranAt: Date }[];
}

export async function tenantOverview(tenantId: string): Promise<TenantOverview> {
  return withTenant(tenantId, async () => {
    const [users, sites, connectors, grantsAll, invites, settings, smtp, sso, recAgg, recOldest, cronRuns] = await Promise.all([
      db.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, status: true, createdAt: true, directoryManaged: true, _count: { select: { sessions: true, passkeys: true } } } }),
      db.site.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, hostname: true, accessMode: true, customDomain: true, probeOk: true, probedAt: true, recordSessions: true, connector: { select: { name: true } } } }),
      db.connector.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, status: true, lastSeenAt: true, version: true, remoteAddr: true, _count: { select: { sites: true } } } }),
      db.accessGrant.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, status: true, requiresApproval: true, approvedAt: true, endsAt: true, createdAt: true, user: { select: { email: true } }, site: { select: { name: true } } } }),
      db.invite.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, email: true, role: true, expiresAt: true, usedAt: true, createdAt: true } }),
      getPlatformSettings(),
      db.smtpConfig.findFirst({ select: { enabled: true, host: true, lastVerifiedOk: true } }),
      db.oidcConfig.findFirst({ select: { enabled: true, issuer: true } }),
      db.sessionRecording.aggregate({ _count: { _all: true }, _sum: { bytes: true } }),
      db.sessionRecording.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } }),
      db.cronRun.findMany({ select: { job: true, ranAt: true } }),
    ]);
    return {
      users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt, directoryManaged: u.directoryManaged, sessions: u._count.sessions, passkeys: u._count.passkeys })),
      sites: sites.map((s) => ({ id: s.id, name: s.name, hostname: s.hostname, accessMode: s.accessMode, customDomain: s.customDomain, probeOk: s.probeOk, probedAt: s.probedAt, recordSessions: s.recordSessions, connectorName: s.connector.name })),
      connectors: connectors.map((c) => ({ id: c.id, name: c.name, status: c.status, lastSeenAt: c.lastSeenAt, version: c.version, remoteAddr: c.remoteAddr, sites: c._count.sites })),
      grants: {
        total: grantsAll.length,
        active: grantsAll.filter((g) => g.status === "ACTIVE" && (!g.requiresApproval || g.approvedAt)).length,
        pending: grantsAll.filter((g) => g.status === "ACTIVE" && g.requiresApproval && !g.approvedAt).length,
        revoked: grantsAll.filter((g) => g.status === "REVOKED").length,
        denied: grantsAll.filter((g) => g.status === "DENIED").length,
        recent: grantsAll.slice(0, 15).map((g) => ({ id: g.id, user: g.user.email, site: g.site.name, status: g.status, requiresApproval: g.requiresApproval, approvedAt: g.approvedAt, endsAt: g.endsAt, createdAt: g.createdAt })),
      },
      invites,
      settings,
      smtp: smtp ? { enabled: smtp.enabled, host: smtp.host, lastVerifiedOk: smtp.lastVerifiedOk } : null,
      sso: sso ? { enabled: sso.enabled, issuer: sso.issuer } : null,
      recordings: { count: recAgg._count._all, bytes: recAgg._sum.bytes ?? 0, oldest: recOldest?.startedAt ?? null },
      cronRuns,
    };
  });
}

export interface TenantAuditView {
  rows: { id: string; timestamp: Date; actorEmail: string | null; action: string; summary: string; targetType: string | null }[];
  total: number;
  integrity: ReturnType<typeof verifyAdminChain>;
}
export async function tenantAdminAudit(tenantId: string, limit = 50): Promise<TenantAuditView> {
  return withTenant(tenantId, async () => {
    const head = await db.auditChainState.findUnique({ where: chainKey("admin"), select: { lastSeq: true, lastHash: true } });
    const [chainRows, total, rows] = await Promise.all([
      db.adminAuditEvent.findMany({ where: head ? { seq: { not: null, lte: head.lastSeq } } : { seq: { not: null } }, orderBy: { seq: "asc" }, select: { seq: true, timestamp: true, actorId: true, actorEmail: true, action: true, targetType: true, targetId: true, summary: true, metadata: true, clientIp: true, prevHash: true, hash: true } }),
      db.adminAuditEvent.count(),
      db.adminAuditEvent.findMany({ orderBy: { timestamp: "desc" }, take: limit, select: { id: true, timestamp: true, actorEmail: true, action: true, summary: true, targetType: true } }),
    ]);
    const events: AdminStored[] = chainRows.map((r) => ({ seq: r.seq as bigint, timestamp: r.timestamp, actorId: r.actorId, actorEmail: r.actorEmail, action: r.action, targetType: r.targetType, targetId: r.targetId, summary: r.summary, metadata: r.metadata ?? null, clientIp: r.clientIp, prevHash: r.prevHash, hash: r.hash }));
    return { rows, total, integrity: verifyAdminChain(events, head ?? undefined) };
  });
}

// Invite (or re-invite) an ADMIN into the tenant; emails via the tenant's own
// SMTP (or the platform fallback) when configured. Always returns the link so
// the operator can hand it over out-of-band.
export async function inviteTenantAdmin(tenant: { id: string; slug: string }, input: { email: string; name?: string }): Promise<{ inviteUrl: string; emailed: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError("invalid_email");
  const name = input.name?.trim() || email;
  const domain = consoleDomain();
  return withTenant(tenant.id, async () => {
    const existing = await db.user.findFirst({ where: { email }, select: { id: true } });
    if (existing) throw new PlatformError("email_registered");
    const { token } = await createInvite({ email, name, role: "ADMIN", createdById: null });
    const inviteUrl = domain ? `https://${tenant.slug}.${domain}/invite/${token}` : `/invite/${token}`;
    let emailed = false;
    try {
      const m = inviteEmail({ name, link: inviteUrl });
      emailed = (await sendMail({ to: email, subject: m.subject, html: m.html, text: m.text })).sent;
    } catch { emailed = false; }
    return { inviteUrl, emailed };
  });
}

// Ends every session in the tenant (all users) — e.g. after a suspected compromise.
export async function forceLogoutTenant(tenantId: string): Promise<number> {
  return withTenant(tenantId, async () => (await db.session.deleteMany({})).count);
}

// Full JSON export of a tenant's configuration and records (recordings excluded
// — they are bulk binary and served by the recordings UI). Used for offboarding,
// audits and data-subject requests.
export async function exportTenant(tenantId: string): Promise<Record<string, unknown>> {
  return withTenant(tenantId, async () => {
    const [tenant, users, sites, connectors, grants, invites, settings, audit, adminAudit, recordings] = await Promise.all([
      db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, status: true, plan: true, createdAt: true } }),
      db.user.findMany({ select: { id: true, email: true, name: true, role: true, status: true, phone: true, company: true, createdAt: true, directoryManaged: true } }),
      db.site.findMany({ select: { id: true, name: true, hostname: true, customDomain: true, upstreamUrl: true, accessMode: true, description: true, recordSessions: true, keystrokeLogging: true, clipboardMode: true, watermark: true, fileTransferMode: true, createdAt: true, connectorId: true } }),
      db.connector.findMany({ select: { id: true, name: true, status: true, lastSeenAt: true, version: true, remoteAddr: true, createdAt: true } }),
      db.accessGrant.findMany({ select: { id: true, userId: true, siteId: true, startsAt: true, endsAt: true, status: true, note: true, denyReason: true, requiresApproval: true, approvedAt: true, approvedById: true, schedule: true, createdById: true, createdAt: true } }),
      db.invite.findMany({ select: { id: true, email: true, name: true, role: true, expiresAt: true, usedAt: true, createdAt: true } }),
      getPlatformSettings(),
      db.auditEvent.findMany({ orderBy: { seq: "asc" }, select: { seq: true, timestamp: true, userEmail: true, siteName: true, host: true, method: true, path: true, status: true, decision: true, reason: true, clientIp: true, hash: true } }),
      db.adminAuditEvent.findMany({ orderBy: { timestamp: "asc" }, select: { seq: true, timestamp: true, actorEmail: true, action: true, targetType: true, targetId: true, summary: true, metadata: true, hash: true } }),
      db.sessionRecording.findMany({ select: { id: true, userId: true, siteId: true, host: true, startedAt: true, lastEventAt: true, eventCount: true, bytes: true, format: true, protocol: true } }),
    ]);
    const safe = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
    return safe({ exportedAt: new Date().toISOString(), tenant, settings, users, connectors, sites, grants, invites, accessAudit: audit, adminAudit, recordings });
  });
}
