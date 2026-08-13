import { can } from "@/lib/auth/roles";
import type { Role } from "@/generated/prisma/enums";

export type NavIconKey =
  | "connectors" | "resources" | "domain"
  | "directory" | "sso" | "policy"
  | "email" | "updates"
  | "users" | "invites" | "opsessions";

export interface NavItem { label: string; href: string; badge?: number; icon?: NavIconKey; desc?: string }
export interface NavColumn { heading: string; items: NavItem[] }
export interface NavGroup { label: string; columns: NavColumn[] }
export interface NavModel {
  primary: NavItem[];
  groups: NavGroup[];
  showSearch: boolean;
  showNotifications: boolean;
  notificationsBadge: number;
}

// Builds the capability-gated top-nav structure. read_console → Console/Access/
// Sessions/Audit/Insights + search + notifications; approve_grants → Access
// pending badge; configure → Recordings (primary) + the Infrastructure & People
// megamenu groups. Group items carry an icon + one-line description for the card
// megamenu; primary items stay plain links. Empty groups are omitted; a 0 badge
// is left undefined for the renderer to suppress.
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
    groups.push({ label: "Infrastructure", columns: [
      { heading: "Connectivity", items: [
        { label: "Connectors", href: "/admin/connectors", icon: "connectors", desc: "Outbound agents linking your sites" },
        { label: "Resources", href: "/admin/sites", icon: "resources", desc: "Hosts & apps vendors can reach" },
        { label: "Custom domain", href: "/admin/domain", icon: "domain", desc: "Your own hostname for the portal" },
      ] },
      { heading: "Identity & access", items: [
        { label: "Directory", href: "/admin/directory", icon: "directory", desc: "Sync users from your IdP groups" },
        { label: "Single sign-on", href: "/admin/sso", icon: "sso", desc: "OIDC login for your operators" },
        { label: "Policy", href: "/admin/policy", icon: "policy", desc: "Access rules, approvals & limits" },
      ] },
      { heading: "Platform", items: [
        { label: "Email", href: "/admin/email", icon: "email", desc: "SMTP for invites & notifications" },
        { label: "Updates", href: "/admin/updates", icon: "updates", desc: "New releases & changelog" },
      ] },
    ] });
    groups.push({ label: "People", columns: [
      { heading: "Team & sessions", items: [
        { label: "Users", href: "/admin/users", icon: "users", desc: "Operators & their roles" },
        { label: "Invites", href: "/admin/invites", icon: "invites", desc: "Pending & sent invitations" },
        { label: "Sessions", href: "/admin/sessions", icon: "opsessions", desc: "Signed-in operator sessions" },
      ] },
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
