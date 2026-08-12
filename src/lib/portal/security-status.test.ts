import { describe, it, expect } from "vitest";
import { securityStatus } from "./security-status";

describe("securityStatus", () => {
  it("passkey + recorded", () => {
    expect(securityStatus({ hasPasskey: true, anyRecorded: true })).toEqual([
      { label: "Passkey enabled", tone: "good" },
      { label: "Sessions recorded & audited", tone: "info" },
      { label: "No VPN required", tone: "muted" },
    ]);
  });
  it("no passkey, not recorded", () => {
    expect(securityStatus({ hasPasskey: false, anyRecorded: false })).toEqual([
      { label: "Passkey not set up", tone: "muted" },
      { label: "No VPN required", tone: "muted" },
    ]);
  });
});
