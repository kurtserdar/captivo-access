import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";
import type { MappingLite } from "@/lib/directory/reconcile";

const CONSOLE_ROLES = ["ADMIN", "OPERATOR", "AUDITOR"] as const;
type ConsoleRole = (typeof CONSOLE_ROLES)[number];

export interface GroupMappingRow {
  id: string;
  groupDN: string;
  kind: "ROLE" | "SITE";
  role: Role | null;
  siteId: string | null;
  siteName: string | null;
  enabled: boolean;
  createdAt: Date;
}

export async function listGroupMappings(): Promise<GroupMappingRow[]> {
  let rows;
  try {
    rows = await db.groupMapping.findMany({
      orderBy: { createdAt: "asc" },
      include: { site: { select: { name: true } } },
    });
  } catch {
    return []; // table missing (pre db-push) or DB down
  }
  return rows.map((r) => ({
    id: r.id,
    groupDN: r.groupDN,
    kind: r.kind === "SITE" ? "SITE" : "ROLE",
    role: r.role,
    siteId: r.siteId,
    siteName: r.site?.name ?? null,
    enabled: r.enabled,
    createdAt: r.createdAt,
  }));
}

// Shape used by the login-time reconcile engine — only enabled, well-formed rows.
export async function listGroupMappingsLite(): Promise<MappingLite[]> {
  let rows;
  try {
    rows = await db.groupMapping.findMany();
  } catch {
    return [];
  }
  const out: MappingLite[] = [];
  for (const r of rows) {
    if (r.kind === "ROLE" && r.role && (CONSOLE_ROLES as readonly string[]).includes(r.role)) {
      out.push({ kind: "ROLE", groupDN: r.groupDN, role: r.role as ConsoleRole, enabled: r.enabled });
    } else if (r.kind === "SITE" && r.siteId) {
      out.push({ kind: "SITE", groupDN: r.groupDN, siteId: r.siteId, enabled: r.enabled });
    }
  }
  return out;
}

export async function createGroupMapping(input: {
  groupDN: string;
  kind: "ROLE" | "SITE";
  role: ConsoleRole | null;
  siteId: string | null;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const groupDN = input.groupDN.trim();
  if (!groupDN) return { ok: false, error: "Group DN is required." };

  if (input.kind === "ROLE") {
    if (!input.role || !(CONSOLE_ROLES as readonly string[]).includes(input.role)) {
      return { ok: false, error: "Choose a console role (Admin, Operator, or Auditor)." };
    }
  } else {
    if (!input.siteId) return { ok: false, error: "Choose a site." };
  }

  // Reject an exact duplicate (same group DN + same target).
  const existing = await db.groupMapping.findMany({ where: { groupDN } });
  const dupe = existing.some((e) =>
    input.kind === "ROLE"
      ? e.kind === "ROLE" && e.role === input.role
      : e.kind === "SITE" && e.siteId === input.siteId,
  );
  if (dupe) return { ok: false, error: "That group is already mapped to this target." };

  await db.groupMapping.create({
    data: {
      groupDN,
      kind: input.kind,
      role: input.kind === "ROLE" ? (input.role as Role) : null,
      siteId: input.kind === "SITE" ? input.siteId : null,
      enabled: input.enabled,
    },
  });
  return { ok: true };
}

export async function updateGroupMapping(
  id: string,
  input: { groupDN?: string; role?: ConsoleRole | null; siteId?: string | null; enabled?: boolean },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (typeof input.groupDN === "string") data.groupDN = input.groupDN.trim();
  if (typeof input.enabled === "boolean") data.enabled = input.enabled;
  if (input.role !== undefined) data.role = input.role;
  if (input.siteId !== undefined) data.siteId = input.siteId;
  await db.groupMapping.update({ where: { id }, data });
}

export async function deleteGroupMapping(id: string): Promise<void> {
  await db.groupMapping.delete({ where: { id } }).catch(() => {});
}
