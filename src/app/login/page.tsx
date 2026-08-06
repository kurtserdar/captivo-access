import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { hasAnyUser } from "@/lib/auth/bootstrap";
import { safeReturnTo } from "@/lib/auth/return-to";
import { getOidcConfig } from "@/lib/auth/oidc-config";
import { LoginForm } from "./login-form";
import { BrandMark } from "@/components/brand";

// getCurrentUser() must be read fresh from the DB on every request.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; error?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/");
  // First-run: with no users yet, there is nothing to log in to — send the
  // operator to the first-admin setup wizard instead of a dead-end login page.
  if (!(await hasAnyUser())) redirect("/setup");

  const sp = await searchParams;
  const returnTo = safeReturnTo(typeof sp.returnTo === "string" ? sp.returnTo : null);
  const sso = await getOidcConfig();
  const ssoEnabled = sso?.enabled ?? false;
  const ssoLabel = sso?.buttonLabel || "Sign in with SSO";
  const errorCode = typeof sp.error === "string" ? sp.error : null;
  const errorMsg =
    errorCode === "disabled" ? "Your account is disabled — contact an administrator."
    : errorCode === "no_account" ? "No account for that identity — ask an administrator to invite you."
    : errorCode === "sso" ? "Sign-in with your identity provider failed. Please try again."
    : null;

  return (
    <div className="auth">
      <div className="auth-card">
        <BrandMark size={34} className="auth-mark" />
        <h1>Sign in</h1>
        <p>Sign in with your device&apos;s passkey.</p>
        <LoginForm returnTo={returnTo} ssoEnabled={ssoEnabled} ssoLabel={ssoLabel} ssoError={errorMsg} />
      </div>
    </div>
  );
}
