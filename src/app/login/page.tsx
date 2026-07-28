import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { safeReturnTo } from "@/lib/auth/return-to";
import { LoginForm } from "./login-form";

// getCurrentUser() must be read fresh from the DB on every request.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/");

  const sp = await searchParams;
  const returnTo = safeReturnTo(typeof sp.returnTo === "string" ? sp.returnTo : null);

  return (
    <main>
      <h1>Sign in</h1>
      <p>Sign in with your device&apos;s passkey.</p>
      <LoginForm returnTo={returnTo} />
    </main>
  );
}
