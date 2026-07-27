import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { LogoutButton } from "./logout-button";

// requireUser() must be read fresh from the DB on every request (session/role changes reflect immediately).
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  VENDOR: "Vendor",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link href="/" className="app-nav-brand">
          Captivo Access
        </Link>
        <div className="app-nav-links">
          <Link href="/">Dashboard</Link>
          <Link href="/settings/passkeys">Settings</Link>
          {user.role === "ADMIN" && <Link href="/admin/users">Admin</Link>}
          {user.role === "ADMIN" && <Link href="/admin/connectors">Connectors</Link>}
          {user.role === "ADMIN" && <Link href="/admin/sites">Sites</Link>}
          <span className="app-nav-user">
            {user.name} · {ROLE_LABEL[user.role] ?? user.role}
          </span>
          <LogoutButton />
        </div>
      </nav>
      {children}
    </div>
  );
}
