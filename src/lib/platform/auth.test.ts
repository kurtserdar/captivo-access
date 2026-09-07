import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({ currentTenantId: vi.fn() }));

import { isPlatformAdmin, requirePlatformAdmin } from "./auth";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { currentTenantId } from "@/lib/tenant/context";

describe("isPlatformAdmin", () => {
  it("is true only for PLATFORM", () => {
    expect(isPlatformAdmin("PLATFORM")).toBe(true);
    for (const r of ["ADMIN", "OPERATOR", "AUDITOR", "STAFF", "VENDOR"] as const) {
      expect(isPlatformAdmin(r)).toBe(false);
    }
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});

describe("requirePlatformAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the user when the request tenant is the platform tenant and role is PLATFORM", async () => {
    (currentTenantId as unknown as ReturnType<typeof vi.fn>).mockReturnValue("platform");
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1", role: "PLATFORM" });

    const u = await requirePlatformAdmin();

    expect(u).toEqual({ id: "u1", role: "PLATFORM" });
    expect(notFound).not.toHaveBeenCalled();
  });

  it("404s when the role is PLATFORM but the request tenant is not the platform tenant", async () => {
    (currentTenantId as unknown as ReturnType<typeof vi.fn>).mockReturnValue("acme-id");
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1", role: "PLATFORM" });

    await expect(requirePlatformAdmin()).rejects.toThrow();

    expect(notFound).toHaveBeenCalled();
  });

  it("404s when the request tenant is the platform tenant but the role is not PLATFORM", async () => {
    (currentTenantId as unknown as ReturnType<typeof vi.fn>).mockReturnValue("platform");
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1", role: "ADMIN" });

    await expect(requirePlatformAdmin()).rejects.toThrow();

    expect(notFound).toHaveBeenCalled();
  });

  it("404s on self-host, where the tenant defaults to \"default\" and the user is ADMIN", async () => {
    (currentTenantId as unknown as ReturnType<typeof vi.fn>).mockReturnValue("default");
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1", role: "ADMIN" });

    await expect(requirePlatformAdmin()).rejects.toThrow();

    expect(notFound).toHaveBeenCalled();
  });

  it("404s when there is no current user", async () => {
    (currentTenantId as unknown as ReturnType<typeof vi.fn>).mockReturnValue("platform");
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(requirePlatformAdmin()).rejects.toThrow();

    expect(notFound).toHaveBeenCalled();
  });
});
