import { db } from "@/lib/db";

/** Initial-setup state: does the system have at least one user? */
export async function hasAnyUser(): Promise<boolean> {
  return (await db.user.count()) > 0;
}
