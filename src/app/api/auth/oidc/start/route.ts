import { NextRequest, NextResponse } from "next/server";
import { getOidcConfig } from "@/lib/auth/oidc-config";
import { discover, randomUrlSafe, codeChallengeS256 } from "@/lib/auth/oidc";
import { setOidcState } from "@/lib/auth/oidc-state";
import { safeReturnTo } from "@/lib/auth/return-to";
import { managerBaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cfg = await getOidcConfig();
  if (!cfg || !cfg.enabled) return NextResponse.redirect(new URL("/login", req.nextUrl));

  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const state = randomUrlSafe();
  const nonce = randomUrlSafe();
  const codeVerifier = randomUrlSafe(64);

  let authorizationEndpoint: string;
  try {
    authorizationEndpoint = (await discover(cfg.issuer)).authorization_endpoint;
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso", req.nextUrl));
  }

  await setOidcState({ state, nonce, codeVerifier, returnTo });

  const redirectUri = `${managerBaseUrl(req)}/api/auth/oidc/callback`;
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallengeS256(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return NextResponse.redirect(url);
}
