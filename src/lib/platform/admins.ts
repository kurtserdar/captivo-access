// Platform operators (PLATFORM role) live in the reserved platform tenant, so
// under the platform request scope these are plain tenant-scoped reads/writes.
import { db } from "@/lib/db";
import { createInvite } from "@/lib/auth/invite";
import { consoleDomain } from "@/lib/tenant/console-domain";
import { PlatformError } from "@/lib/platform/tenants";

export async function listPlatformAdmins() {
  const [users, invites] = await Promise.all([
    db.user.findMany({ where: { role: "PLATFORM" }, orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, status: true, createdAt: true, _count: { select: { passkeys: true, sessions: true } } } }),
    db.invite.findMany({ where: { role: "PLATFORM", usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, name: true, expiresAt: true, createdAt: true } }),
  ]);
  return { users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, status: u.status, createdAt: u.createdAt, passkeys: u._count.passkeys, sessions: u._count.sessions })), invites };
}

export async function invitePlatformAdmin(input: { email: string; name?: string }): Promise<{ inviteUrl: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError("invalid_email");
  if (await db.user.findFirst({ where: { email }, select: { id: true } })) throw new PlatformError("email_registered");
  const { token } = await createInvite({ email, name: input.name?.trim() || email, role: "PLATFORM", createdById: null });
  const domain = consoleDomain();
  return { inviteUrl: domain ? `https://platform.${domain}/invite/${token}` : `/invite/${token}` };
}

// Removing an operator: never yourself, never the last one.
export async function removePlatformAdmin(id: string, actorId: string): Promise<void> {
  if (id === actorId) throw new PlatformError("cannot_remove_self");
  const count = await db.user.count({ where: { role: "PLATFORM", status: "ACTIVE" } });
  if (count <= 1) throw new PlatformError("last_admin");
  const u = await db.user.findUnique({ where: { id }, select: { role: true } });
  if (!u || u.role !== "PLATFORM") throw new PlatformError("not_found");
  await db.user.delete({ where: { id } });
}

export async function endPlatformAdminSessions(id: string): Promise<number> {
  return (await db.session.deleteMany({ where: { userId: id } })).count;
}
