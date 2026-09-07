import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/tenant/request", () => ({ withTenantRoute: (h: unknown) => h }));
vi.mock("@/lib/platform/auth", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/platform/tenants", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platform/tenants")>("@/lib/platform/tenants");
  return { ...actual, createTenant: vi.fn() };
});

import { POST } from "./route";
import { createTenant, PlatformError } from "@/lib/platform/tenants";

function req(body: unknown) {
  return new Request("http://x/api/platform/tenants", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("POST /api/platform/tenants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a tenant and returns the invite token", async () => {
    (createTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      tenant: { id: "t1", slug: "acme", name: "Acme" }, inviteToken: "tok",
    });
    const res = await POST(req({ name: "Acme", slug: "acme", adminEmail: "a@acme.co" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tenant: { slug: "acme" }, inviteToken: "tok" });
  });

  it("maps a PlatformError to a 400 with its code", async () => {
    (createTenant as ReturnType<typeof vi.fn>).mockRejectedValue(new PlatformError("slug_taken"));
    const res = await POST(req({ name: "Acme", slug: "acme", adminEmail: "a@acme.co" }) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "slug_taken" });
  });
});
