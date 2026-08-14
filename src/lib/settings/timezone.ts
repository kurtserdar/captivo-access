import { db } from "@/lib/db";
import { getPlatformSettings } from "./platform";

// Resolved display timezone for a user: their own override, else the global
// default, else null (the client falls back to the viewer's browser timezone).
export async function resolvedDisplayTimezone(userId: string): Promise<string | null> {
  const [user, s] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    getPlatformSettings(),
  ]);
  return user?.timezone ?? s.displayTimezone ?? null;
}
