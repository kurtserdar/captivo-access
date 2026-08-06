import { headers } from "next/headers";
import { requireCapability } from "@/lib/current-user";
import { getOidcConfig } from "@/lib/auth/oidc-config";
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
          <h1>Single sign-on (OIDC)</h1>
          <p>Let internal users sign in with your identity provider (Microsoft Entra, Google Workspace, Okta). Vendors continue to use passkeys.</p>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Register this redirect URI in your IdP</h2></div>
        <pre className="code"><code>{redirectUri}</code></pre>
        <p className="cell-sub">Create an OIDC app in your IdP, add the redirect URI above, then paste its Issuer, Client ID, and Client secret below. Request scopes <code>openid email profile</code>.</p>
      </div>
      <div className="card">
        <SsoForm initial={initial} />
      </div>
    </main>
  );
}
