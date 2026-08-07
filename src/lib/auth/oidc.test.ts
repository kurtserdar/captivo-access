import { describe, it, expect } from "vitest";
import { normalizeIssuer, codeChallengeS256, checkClaims } from "./oidc";

describe("normalizeIssuer", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeIssuer("https://accounts.google.com/")).toBe("https://accounts.google.com");
  });
  it("leaves a slash-less issuer alone", () => {
    expect(normalizeIssuer("https://login.microsoftonline.com/t/v2.0")).toBe("https://login.microsoftonline.com/t/v2.0");
  });
});

describe("codeChallengeS256 (RFC 7636 Appendix B vector)", () => {
  it("derives the known challenge from the known verifier", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("checkClaims", () => {
  const base = { issuer: "https://idp.example.com", clientId: "client-123", nonce: "n-abc" };
  const good = {
    iss: "https://idp.example.com", aud: "client-123", nonce: "n-abc",
    email: "Dana@Acme.com", email_verified: true, name: "Dana",
  };
  it("accepts a well-formed token and lowercases the email", () => {
    expect(checkClaims(good, base)).toEqual({ ok: true, email: "dana@acme.com" });
  });
  it("rejects a wrong issuer", () => {
    expect(checkClaims({ ...good, iss: "https://evil.example.com" }, base).ok).toBe(false);
  });
  it("rejects when aud does not include the client id", () => {
    expect(checkClaims({ ...good, aud: "other-client" }, base).ok).toBe(false);
  });
  it("rejects an aud array that omits the client id", () => {
    expect(checkClaims({ ...good, aud: ["other-a", "other-b"] }, base).ok).toBe(false);
  });
  it("rejects when azp mismatches on a multi-aud token", () => {
    expect(checkClaims({ ...good, aud: ["client-123", "x"], azp: "x" }, base).ok).toBe(false);
  });
  it("accepts a multi-aud token whose azp matches", () => {
    expect(checkClaims({ ...good, aud: ["client-123", "x"], azp: "client-123" }, base).ok).toBe(true);
  });
  it("rejects a mismatched nonce", () => {
    expect(checkClaims({ ...good, nonce: "n-other" }, base).ok).toBe(false);
  });
  it("rejects an unverified email", () => {
    expect(checkClaims({ ...good, email_verified: false }, base).ok).toBe(false);
  });
  it("rejects a non-boolean truthy email_verified (string \"true\")", () => {
    expect(checkClaims({ ...good, email_verified: "true" as unknown as boolean }, base).ok).toBe(false);
  });
  it("rejects a missing email", () => {
    expect(checkClaims({ ...good, email: undefined }, base).ok).toBe(false);
  });
  // The caller passes the discovery document's authoritative `issuer`, which for
  // some IdPs (e.g. Auth0) carries a trailing slash. A trailing-slash iss must
  // match a trailing-slash expected issuer exactly — and must NOT match the
  // slash-stripped form (the bug this guards: never compare against a normalized issuer).
  it("matches an issuer verbatim, trailing slash included (Auth0)", () => {
    const slash = { issuer: "https://x.us.auth0.com/", clientId: "client-123", nonce: "n-abc" };
    expect(checkClaims({ ...good, iss: "https://x.us.auth0.com/" }, slash).ok).toBe(true);
    expect(checkClaims({ ...good, iss: "https://x.us.auth0.com" }, slash).ok).toBe(false);
  });
});
