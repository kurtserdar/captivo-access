import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";
import { SUPPORT_COOKIE } from "@/lib/support/session";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete({ name: SESSION_COOKIE, path: "/" });
  // A platform support session on this host ends with the same button.
  const support = store.get(SUPPORT_COOKIE)?.value;
  if (support) await destroySession(support);
  store.delete({ name: SUPPORT_COOKIE, path: "/" });
  return NextResponse.json({ ok: true });
}
