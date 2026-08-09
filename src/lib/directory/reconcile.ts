import type { Role } from "@/generated/prisma/enums";

export type MappingLite =
  | { kind: "ROLE"; groupDN: string; role: "ADMIN" | "OPERATOR" | "AUDITOR"; enabled: boolean }
  | { kind: "SITE"; groupDN: string; siteId: string; enabled: boolean };

export interface ReconcileDecision {
  deprovision: boolean;
  role: Role | null;
  grantSiteIds: string[];
}

const ROLE_RANK: Record<"ADMIN" | "OPERATOR" | "AUDITOR", number> = { ADMIN: 3, OPERATOR: 2, AUDITOR: 1 };

// AD DNs are case-insensitive; memberOf values and admin-typed DNs can also
// differ in whitespace after commas. Normalize both sides before comparing.
export function normalizeDN(dn: string): string {
  return dn
    .split(",")
    .map((p) => p.trim())
    .join(",")
    .toLowerCase();
}

export function computeReconcile(
  resolvedGroups: string[],
  mappings: MappingLite[],
  user: { directoryManaged: boolean },
): ReconcileDecision {
  const groupSet = new Set(resolvedGroups.map(normalizeDN));
  const matched = mappings.filter((m) => m.enabled && groupSet.has(normalizeDN(m.groupDN)));

  if (matched.length === 0) {
    return { deprovision: user.directoryManaged, role: null, grantSiteIds: [] };
  }

  const roleMatches = matched.filter((m): m is Extract<MappingLite, { kind: "ROLE" }> => m.kind === "ROLE");
  const siteMatches = matched.filter((m): m is Extract<MappingLite, { kind: "SITE" }> => m.kind === "SITE");

  let role: Role | null = null;
  if (roleMatches.length > 0) {
    role = roleMatches.reduce<"ADMIN" | "OPERATOR" | "AUDITOR">(
      (best, m) => (ROLE_RANK[m.role] > ROLE_RANK[best] ? m.role : best),
      roleMatches[0].role,
    );
  } else if (siteMatches.length > 0) {
    role = "STAFF";
  }

  const grantSiteIds = [...new Set(siteMatches.map((m) => m.siteId))];
  return { deprovision: false, role, grantSiteIds };
}

export function planGrantChanges(
  currentDirGrantSiteIds: string[],
  desiredSiteIds: string[],
): { toCreateSiteIds: string[]; toRevokeSiteIds: string[] } {
  const cur = new Set(currentDirGrantSiteIds);
  const des = new Set(desiredSiteIds);
  return {
    toCreateSiteIds: [...des].filter((s) => !cur.has(s)),
    toRevokeSiteIds: [...cur].filter((s) => !des.has(s)),
  };
}
