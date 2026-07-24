import { describe, it, expect, afterEach } from "vitest";
import { getRpId, originMatchesRp } from "./rp";

afterEach(() => { delete process.env.WEBAUTHN_RP_ID; });

describe("rp", () => {
  it("env yoksa localhost", () => { expect(getRpId()).toBe("localhost"); });
  it("env'den okur", () => { process.env.WEBAUTHN_RP_ID = "access.acme.com"; expect(getRpId()).toBe("access.acme.com"); });
  it("origin RP-ID ile eşleşir (aynı registrable domain)", () => {
    expect(originMatchesRp("https://access.acme.com", "access.acme.com")).toBe(true);
    expect(originMatchesRp("http://localhost:3100", "localhost")).toBe(true);
    expect(originMatchesRp("https://evil.com", "access.acme.com")).toBe(false);
  });
});
