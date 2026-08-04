"use client";
import { usePathname } from "next/navigation";
import type { SearchRecord } from "@/lib/search";
import { CommandPalette } from "./command-palette";

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/access": "My access",
  "/admin/grants": "Grants",
  "/admin/connectors": "Connectors",
  "/admin/sites": "Sites",
  "/admin/notifications": "Notifications",
  "/admin/users": "Users",
  "/admin/invites": "Invites",
  "/admin/sessions": "Sessions",
  "/admin/audit": "Audit log",
  "/settings/passkeys": "Settings",
};

export function Topbar({ records, admin }: { records: SearchRecord[]; admin: boolean }) {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? "Captivo Access";
  return (
    <header className="topbar">
      <span className="topbar-title">{title}</span>
      <CommandPalette records={records} admin={admin} />
    </header>
  );
}
