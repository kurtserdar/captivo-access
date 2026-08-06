import type { Role } from "@/generated/prisma/enums";

export type Capability = "configure" | "approve_grants" | "read_console";

// Fixed capability sets per role. Record<Role, …> is exhaustive: adding a Role
// value without updating this map is a compile error (a deliberate guard).
const ROLE_CAPS: Record<Role, Capability[]> = {
  ADMIN: ["configure", "approve_grants", "read_console"],
  OPERATOR: ["approve_grants", "read_console"],
  AUDITOR: ["read_console"],
  STAFF: [],
  VENDOR: [],
};

export function can(role: Role, cap: Capability): boolean {
  return ROLE_CAPS[role].includes(cap);
}

// A console user has at least one capability (ADMIN, OPERATOR, AUDITOR).
// STAFF/VENDOR are connect-only and never see the admin console.
export function isConsoleUser(role: Role): boolean {
  return ROLE_CAPS[role].length > 0;
}

// Display labels (English only). Single source — imported everywhere a role is shown.
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  OPERATOR: "Operator",
  AUDITOR: "Auditor",
  STAFF: "Staff",
  VENDOR: "Vendor",
};

// Roles selectable when inviting/creating a user.
export const ASSIGNABLE_ROLES: Role[] = ["ADMIN", "OPERATOR", "AUDITOR", "STAFF", "VENDOR"];
