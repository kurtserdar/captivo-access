import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { LoginForm } from "./login-form";

// getCurrentUser() must be read fresh from the DB on every request.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main>
      <h1>Sign in</h1>
      <p>Sign in with your device&apos;s passkey.</p>
      <LoginForm />
    </main>
  );
}
