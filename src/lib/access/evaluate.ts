import { db } from "@/lib/db";

export type DecisionReason =
  | "allow" | "user_disabled" | "no_grant"
  | "revoked" | "denied" | "not_yet" | "expired" | "pending_approval";

export interface Decision { allow: boolean; reason: DecisionReason }

interface GrantWindow {
  status: "ACTIVE" | "REVOKED" | "DENIED";
  startsAt: Date | null;
  endsAt: Date | null;
  requiresApproval: boolean;
  approvedAt: Date | null;
}

// Deny-reason priority when multiple grants all deny: show the most "promising"
// reason (soonest/most-actionable) → pending_approval > not_yet > expired > revoked/denied.
// (no_grant and user_disabled are handled before this table, never compared here.)
const DENY_PRIORITY: Record<"pending_approval" | "not_yet" | "expired" | "revoked" | "denied", number> = {
  pending_approval: 4, not_yet: 3, expired: 2, revoked: 1, denied: 1,
};

export function classifyGrant(g: GrantWindow, now: Date): DecisionReason {
  if (g.status === "REVOKED") return "revoked";
  if (g.status === "DENIED") return "denied";
  if (g.startsAt && now < g.startsAt) return "not_yet";
  if (g.endsAt && now > g.endsAt) return "expired";
  if (g.requiresApproval && !g.approvedAt) return "pending_approval";
  return "allow";
}

export async function evaluateAccess(userId: string, siteId: string, now: Date): Promise<Decision> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== "ACTIVE") return { allow: false, reason: "user_disabled" };

  const grants = await db.accessGrant.findMany({ where: { userId, siteId } });
  if (grants.length === 0) return { allow: false, reason: "no_grant" };

  let best: "pending_approval" | "not_yet" | "expired" | "revoked" | "denied" | null = null;
  for (const g of grants) {
    const d = classifyGrant(g, now);
    if (d === "allow") return { allow: true, reason: "allow" };
    const dd = d as "pending_approval" | "not_yet" | "expired" | "revoked" | "denied";
    if (best === null || DENY_PRIORITY[dd] > DENY_PRIORITY[best]) best = dd;
  }
  return { allow: false, reason: best! };
}
