import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { LogoutButton } from "./logout-button";

// requireUser() her istekte DB'den taze okunmalı (session/rol değişikliği anında yansısın).
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Yönetici",
  VENDOR: "Tedarikçi",
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
          <Link href="/">Panel</Link>
          <Link href="/settings/passkeys">Ayarlar</Link>
          {user.role === "ADMIN" && <Link href="/admin/users">Yönetim</Link>}
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
