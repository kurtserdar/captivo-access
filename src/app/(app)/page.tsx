import { requireUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  VENDOR: "Vendor",
};

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main>
      <h1>Welcome, {user.name}</h1>
      <span className="badge">{ROLE_LABEL[user.role] ?? user.role}</span>
      <p>
        Access features (vendor sessions, approval flows) will be added in a
        future release. For now you can manage your account under{" "}
        <a href="/settings/passkeys">Settings</a>.
      </p>
    </main>
  );
}
