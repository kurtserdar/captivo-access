import { describe, it, expect, afterEach } from "vitest";
import { getRpId, originMatchesRp } from "./rp";

afterEach(() => { delete process.env.WEBAUTHN_RP_ID; });

describe("rp", () => {
  it("falls back to localhost when env is unset", () => { expect(getRpId()).toBe("localhost"); });
  it("reads from env", () => { process.env.WEBAUTHN_RP_ID = "access.acme.com"; expect(getRpId()).toBe("access.acme.com"); });
  it("origin matches RP-ID (same registrable domain)", () => {
    expect(originMatchesRp("https://access.acme.com", "access.acme.com")).toBe(true);
    expect(originMatchesRp("http://localhost:3100", "localhost")).toBe(true);
    expect(originMatchesRp("https://evil.com", "access.acme.com")).toBe(false);
  });
  it("origin matches RP-ID from a subdomain (RP-ID is a registrable suffix)", () => {
    // A page at manager.<domain> may use the bare <domain> as its RP-ID — the
    // WebAuthn spec allows the RP-ID to be a registrable suffix of the origin.
    expect(originMatchesRp("https://manager.access.acme.com", "access.acme.com")).toBe(true);
    expect(originMatchesRp("https://printer.access.acme.com", "access.acme.com")).toBe(true);
  });
  it("rejects look-alike hosts that only share a suffix without a dot boundary", () => {
    expect(originMatchesRp("https://evil-access.acme.com", "access.acme.com")).toBe(false); // no dot before "access"
    expect(originMatchesRp("https://access.acme.com.evil.com", "access.acme.com")).toBe(false); // rpId is not a suffix
  });
});
