import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth/bootstrap";
import { SetupForm } from "./setup-form";
import { BrandMark } from "@/components/brand";
import { AuthShell } from "@/components/auth-shell";

// hasAnyUser() must be read fresh from the DB on every request — build-time
// prerendering (static export) would produce a wrong/stale result and would
// also break the build without a DB.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");

  return (
    <AuthShell>
      <BrandMark size={34} className="auth-mark" />
      <h1>Create your account</h1>
      <p>
        Captivo Access hasn&apos;t been set up yet. Enter your name and email
        address and register with your device&apos;s passkey to create the
        first admin account.
      </p>
      <SetupForm />
    </AuthShell>
  );
}
