import { can } from "@/lib/auth/roles";
import type { Role } from "@/generated/prisma/enums";

export interface NavItem { label: string; href: string; badge?: number }
export interface NavGroup { label: string; items: NavItem[] }
export interface NavModel {
  primary: NavItem[];
  groups: NavGroup[];
  showSearch: boolean;
  showNotifications: boolean;
  notificationsBadge: number;
}

// Builds the capability-gated top-nav structure. Mirrors the previous sidebar's
// gating: read_console → Console/Access/Sessions/Audit + search + notifications;
// approve_grants → Access pending badge; configure → Recordings + Infrastructure
// + People. Empty groups are omitted; a 0 badge is left undefined for the
// renderer to suppress.
export function buildNavModel(role: Role, counts: { pending: number; unread: number }): NavModel {
  const read = can(role, "read_console");
  const config = can(role, "configure");
  const grants = can(role, "approve_grants");

  const primary: NavItem[] = [];
  if (read) {
    primary.push({ label: "Console", href: "/" });
    primary.push({ label: "Access", href: "/admin/grants", badge: grants && counts.pending > 0 ? counts.pending : undefined });
    primary.push({ label: "Sessions", href: "/admin/live" });
  }
  if (config) primary.push({ label: "Recordings", href: "/admin/recordings" });
  if (read) primary.push({ label: "Audit", href: "/admin/audit" });
  if (read) primary.push({ label: "Insights", href: "/admin/insights" });

  const groups: NavGroup[] = [];
  if (config) {
    groups.push({ label: "Infrastructure", items: [
      { label: "Connectors", href: "/admin/connectors" },
      { label: "Resources", href: "/admin/sites" },
      { label: "Email", href: "/admin/email" },
      { label: "Single sign-on", href: "/admin/sso" },
      { label: "Directory", href: "/admin/directory" },
      { label: "Policy", href: "/admin/policy" },
      { label: "Custom domain", href: "/admin/domain" },
      { label: "Updates", href: "/admin/updates" },
    ] });
    groups.push({ label: "People", items: [
      { label: "Users", href: "/admin/users" },
      { label: "Invites", href: "/admin/invites" },
      { label: "Sessions", href: "/admin/sessions" },
    ] });
  }

  return {
    primary,
    groups,
    showSearch: read,
    showNotifications: read,
    notificationsBadge: read ? counts.unread : 0,
  };
}
