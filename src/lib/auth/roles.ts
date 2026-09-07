import type { Role } from "@/generated/prisma/enums";

export type Capability = "configure" | "approve_grants" | "read_console" | "manage_tenants";

// Fixed capability sets per role. Record<Role, …> is exhaustive: adding a Role
// value without updating this map is a compile error (a deliberate guard).
const ROLE_CAPS: Record<Role, Capability[]> = {
  ADMIN: ["configure", "approve_grants", "read_console"],
  OPERATOR: ["approve_grants", "read_console"],
  AUDITOR: ["read_console"],
  STAFF: [],
  VENDOR: [],
  // Platform super-admin: manages tenants only. NOT a tenant-console user
  // (holds no read_console), so it never reaches the (app) console.
  PLATFORM: ["manage_tenants"],
};

export function can(role: Role, cap: Capability): boolean {
  return ROLE_CAPS[role].includes(cap);
}

// A console user can read the tenant admin console. Keyed on read_console
// (not "any capability") so PLATFORM — which only manages tenants — is excluded.
export function isConsoleUser(role: Role): boolean {
  return ROLE_CAPS[role].includes("read_console");
}

// Display labels (English only). Single source — imported everywhere a role is shown.
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  OPERATOR: "Operator",
  AUDITOR: "Auditor",
  STAFF: "Staff",
  VENDOR: "Vendor",
  PLATFORM: "Platform",
};

// Roles selectable when inviting/creating a tenant user. PLATFORM is provisioned
// only via platform first-run, never through this list.
export const ASSIGNABLE_ROLES: Role[] = ["ADMIN", "OPERATOR", "AUDITOR", "STAFF", "VENDOR"];
