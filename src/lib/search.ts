import { db } from "@/lib/db";

export type SearchRecord = {
  id: string;
  type: "site" | "connector" | "user";
  label: string;
  sub: string | null;
  href: string;
};

export async function getSearchRecords(): Promise<SearchRecord[]> {
  const [sites, connectors, users] = await Promise.all([
    db.site.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, hostname: true } }),
    db.connector.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
  ]);
  return [
    ...sites.map((s) => ({ id: s.id, type: "site" as const, label: s.name, sub: s.hostname, href: "/admin/sites" })),
    ...connectors.map((c) => ({ id: c.id, type: "connector" as const, label: c.name, sub: null, href: "/admin/connectors" })),
    ...users.map((u) => ({
      id: u.id,
      type: "user" as const,
      label: u.name,
      sub: u.email,
      href: `/admin/users?q=${encodeURIComponent(u.email)}`,
    })),
  ];
}
