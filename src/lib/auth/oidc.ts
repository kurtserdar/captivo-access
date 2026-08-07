import { createHash, randomBytes } from "node:crypto";

export function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export type IdClaims = {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

// Claim checks that do NOT need network I/O. Signature + exp/nbf are verified by
// jose.jwtVerify in the callback BEFORE this runs; this enforces the rest.
export function checkClaims(
  claims: IdClaims,
  expect: { issuer: string; clientId: string; nonce: string },
): { ok: true; email: string } | { ok: false; reason: string } {
  if (claims.iss !== expect.issuer) return { ok: false, reason: "iss" };
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(expect.clientId) : aud === expect.clientId;
  if (!audOk) return { ok: false, reason: "aud" };
  // When multiple audiences are present, azp (authorized party) must be our client.
  if (Array.isArray(aud) && aud.length > 1 && claims.azp !== expect.clientId) return { ok: false, reason: "azp" };
  if (!claims.nonce || claims.nonce !== expect.nonce) return { ok: false, reason: "nonce" };
  if (claims.email_verified !== true) return { ok: false, reason: "email_verified" };
  const email = claims.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "email" };
  return { ok: true, email };
}

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; userinfo_endpoint?: string };
const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

export async function discover(issuer: string): Promise<Discovery> {
  const norm = normalizeIssuer(issuer);
  const cached = discoveryCache.get(norm);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const res = await fetch(`${norm}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`discovery_failed_${res.status}`);
  const doc = (await res.json()) as Discovery;
  // `issuer` is the authoritative value the IdP stamps into every token's `iss`
  // (it may differ from the configured issuer by a trailing slash — e.g. Auth0).
  // The ID-token `iss` is verified against THIS, not the slash-stripped config.
  if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new Error("discovery_incomplete");
  discoveryCache.set(norm, { at: Date.now(), doc });
  return doc;
}
