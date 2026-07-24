import { db } from "@/lib/db";

/** İlk-kurulum durumu: sistemde en az bir kullanıcı var mı? */
export async function hasAnyUser(): Promise<boolean> {
  return (await db.user.count()) > 0;
}
