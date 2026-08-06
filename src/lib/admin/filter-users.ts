import type { Role } from "@/generated/prisma/enums";

export type UserFilter = { q: string; status: "all" | "ACTIVE" | "DISABLED"; role: "all" | Role };

export function filterUsers<T extends { name: string; email: string; status: string; role: string }>(
  users: T[],
  f: UserFilter,
): T[] {
  const q = f.q.trim().toLowerCase();
  return users.filter((u) => {
    if (f.status !== "all" && u.status !== f.status) return false;
    if (f.role !== "all" && u.role !== f.role) return false;
    if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    return true;
  });
}
