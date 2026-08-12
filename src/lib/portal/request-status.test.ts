import { describe, it, expect } from "vitest";
import { requestStatus } from "./request-status";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("requestStatus", () => {
  it("DENIED → denied", () => expect(requestStatus({ status: "DENIED", approvedAt: null, endsAt: null }, NOW)).toBe("denied"));
  it("REVOKED → withdrawn", () => expect(requestStatus({ status: "REVOKED", approvedAt: "2026-08-11T00:00:00Z", endsAt: null }, NOW)).toBe("withdrawn"));
  it("no approval → pending", () => expect(requestStatus({ status: "ACTIVE", approvedAt: null, endsAt: null }, NOW)).toBe("pending"));
  it("approved + past end → expired", () => expect(requestStatus({ status: "ACTIVE", approvedAt: "2026-08-10T00:00:00Z", endsAt: "2026-08-11T00:00:00Z" }, NOW)).toBe("expired"));
  it("approved + future/no end → approved", () => {
    expect(requestStatus({ status: "ACTIVE", approvedAt: "2026-08-10T00:00:00Z", endsAt: "2026-08-20T00:00:00Z" }, NOW)).toBe("approved");
    expect(requestStatus({ status: "ACTIVE", approvedAt: "2026-08-10T00:00:00Z", endsAt: null }, NOW)).toBe("approved");
  });
});
