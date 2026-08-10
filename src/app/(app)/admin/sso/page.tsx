import { headers } from "next/headers";
import { requireCapability } from "@/lib/current-user";
import { getOidcConfig } from "@/lib/auth/oidc-config";
import { LastVerified } from "@/app/(app)/_shell/last-verified";
import { SsoForm } from "./sso-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Single sign-on" };

export default async function AdminSsoPage() {
  await requireCapability("configure");
  const cfg = await getOidcConfig();

  // Show the redirect URI to register in the IdP (derived from the public URL).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const base = process.env.MANAGER_PUBLIC_URL?.replace(/\/+$/, "") || (host ? `${proto}://${host}` : "");
  const redirectUri = `${base}/api/auth/oidc/callback`;

  const initial = {
    enabled: cfg?.enabled ?? false,
    issuer: cfg?.issuer ?? "",
    clientId: cfg?.clientId ?? "",
    buttonLabel: cfg?.buttonLabel ?? "",
    hasSecret: cfg?.hasSecret ?? false,
  };

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="page-title-row"><span className="page-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5 21 2"/><path d="M16 7l3 3"/></svg></span><h1>Single sign-on (OIDC)</h1></div>
          <p>Let internal users sign in with your identity provider (Microsoft Entra, Google Workspace, Okta). Vendors continue to use passkeys.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Register this redirect URI in your IdP</h2></div>
        <pre className="code"><code>{redirectUri}</code></pre>
        <p className="cell-sub">Create an OIDC app in your IdP, add the redirect URI above, then paste its Issuer, Client ID, and Client secret below. Request scopes <code>openid email profile</code>.</p>
      </div>
      <div className="card">
        <LastVerified at={cfg?.lastVerifiedAt ?? null} ok={cfg?.lastVerifiedOk ?? null} detail={cfg?.lastVerifiedDetail ?? null} />
        <SsoForm initial={initial} />
      </div>
    </main>
  );
}
