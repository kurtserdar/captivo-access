import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { db } from "@/lib/db";
import { getOidcConfig, getOidcSecret } from "@/lib/auth/oidc-config";
import { discover, checkClaims, normalizeIssuer, type IdClaims } from "@/lib/auth/oidc";
import { readOidcState, clearOidcState } from "@/lib/auth/oidc-state";
import { startSession } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/auth/return-to";
import { managerBaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

function fail(req: NextRequest, error: string) {
  const url = new URL(`/login?error=${error}`, req.nextUrl);
  const res = NextResponse.redirect(url);
  return res;
}

export async function GET(req: NextRequest) {
  const cfg = await getOidcConfig();
  const saved = await readOidcState();
  await clearOidcState(); // single-use, always cleared

  if (!cfg || !cfg.enabled) return fail(req, "sso");
  if (!saved) return fail(req, "sso");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(req, "sso");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || state !== saved.state) return fail(req, "sso");

  let disc;
  try {
    disc = await discover(cfg.issuer);
  } catch {
    return fail(req, "sso");
  }

  const secret = await getOidcSecret();
  if (!secret) return fail(req, "sso");

  // Exchange the code (PKCE + client_secret_post).
  const redirectUri = `${managerBaseUrl(req)}/api/auth/oidc/callback`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: secret,
    code_verifier: saved.codeVerifier,
  });
  let tokens: { id_token?: string; access_token?: string };
  try {
    const res = await fetch(disc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
    if (!res.ok) return fail(req, "sso");
    tokens = await res.json();
  } catch {
    return fail(req, "sso");
  }
  if (!tokens.id_token) return fail(req, "sso");

  // Verify the ID token: signature (JWKS) + iss + aud + exp/nbf via jose.
  let claims: IdClaims;
  try {
    const JWKS = createRemoteJWKSet(new URL(disc.jwks_uri));
    const { payload } = await jwtVerify(tokens.id_token, JWKS, {
      issuer: normalizeIssuer(cfg.issuer),
      audience: cfg.clientId,
      algorithms: ["RS256", "ES256", "PS256"],
    });
    claims = payload as IdClaims;
  } catch {
    return fail(req, "sso");
  }

  // Remaining claim checks (azp/nonce/email_verified) + email extraction.
  const checked = checkClaims(claims, { issuer: normalizeIssuer(cfg.issuer), clientId: cfg.clientId, nonce: saved.nonce });
  if (!checked.ok) return fail(req, "sso");
  const email = checked.email;

  // Provisioning (spec §5): existing ACTIVE user, else redeem an invite, else reject.
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (user) {
    if (user.status !== "ACTIVE") return fail(req, "disabled");
    await startSession(user.id, req);
    return NextResponse.redirect(new URL(safeReturnTo(saved.returnTo), req.nextUrl));
  }

  const invite = await db.invite.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!invite) return fail(req, "no_account");

  // Atomically consume the invite; a race (or a passkey enrollment in flight)
  // that already used it makes updateMany match 0 rows → bail.
  const consumed = await db.invite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date() } });
  if (consumed.count === 0) return fail(req, "no_account");

  let created;
  try {
    created = await db.user.create({
      data: {
        email: invite.email,
        name: invite.name || claims.name || email.split("@")[0],
        role: invite.role,
        status: "ACTIVE",
      },
    });
  } catch {
    return fail(req, "sso");
  }
  await startSession(created.id, req);
  return NextResponse.redirect(new URL(safeReturnTo(saved.returnTo), req.nextUrl));
}
