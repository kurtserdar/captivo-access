import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/tenant/enabled", () => ({ multiTenantEnabled: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({ currentTenantId: vi.fn() }));

import { resolveSetupRole } from "./setup-role";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { currentTenantId } from "@/lib/tenant/context";

describe("resolveSetupRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("self-host (flag off) → ADMIN", () => {
    (multiTenantEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(resolveSetupRole()).toEqual({ allowed: true, role: "ADMIN" });
  });
  it("cloud + platform host → PLATFORM", () => {
    (multiTenantEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (currentTenantId as unknown as ReturnType<typeof vi.fn>).mockReturnValue("platform");
    expect(resolveSetupRole()).toEqual({ allowed: true, role: "PLATFORM" });
  });
  it("cloud + tenant host → not allowed (invite-only)", () => {
    (multiTenantEnabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (currentTenantId as unknown as ReturnType<typeof vi.fn>).mockReturnValue("acme-id");
    expect(resolveSetupRole()).toEqual({ allowed: false });
  });
});
