import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/tenant/enabled", () => ({ multiTenantEnabled: vi.fn() }));
vi.mock("@/lib/tenant/internal", () => ({ resolveTenantByHostname: vi.fn() }));
vi.mock("@/lib/tenant/request", () => ({ resolveRequestTenant: vi.fn() }));

import { crossTenantHostnameTaken } from "./hostname";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { resolveTenantByHostname } from "@/lib/tenant/internal";
import { resolveRequestTenant } from "@/lib/tenant/request";

const mtEnabled = multiTenantEnabled as unknown as ReturnType<typeof vi.fn>;
const byHost = resolveTenantByHostname as unknown as ReturnType<typeof vi.fn>;
const reqTenant = resolveRequestTenant as unknown as ReturnType<typeof vi.fn>;

describe("crossTenantHostnameTaken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flag off: always false, resolvers not called", async () => {
    mtEnabled.mockReturnValue(false);
    expect(await crossTenantHostnameTaken("printer.sites.cloud.captivo.io")).toBe(false);
    expect(byHost).not.toHaveBeenCalled();
  });

  it("taken by another tenant → true", async () => {
    mtEnabled.mockReturnValue(true);
    byHost.mockResolvedValue("tenantA");
    reqTenant.mockResolvedValue("tenantB");
    expect(await crossTenantHostnameTaken("printer.sites.cloud.captivo.io")).toBe(true);
  });

  it("owned by the acting tenant (own site) → false", async () => {
    mtEnabled.mockReturnValue(true);
    byHost.mockResolvedValue("tenantA");
    reqTenant.mockResolvedValue("tenantA");
    expect(await crossTenantHostnameTaken("printer.sites.cloud.captivo.io")).toBe(false);
  });

  it("unowned hostname → false", async () => {
    mtEnabled.mockReturnValue(true);
    byHost.mockResolvedValue(null);
    reqTenant.mockResolvedValue("tenantB");
    expect(await crossTenantHostnameTaken("free.sites.cloud.captivo.io")).toBe(false);
  });

  it("empty hostname → false", async () => {
    mtEnabled.mockReturnValue(true);
    expect(await crossTenantHostnameTaken(null)).toBe(false);
    expect(byHost).not.toHaveBeenCalled();
  });
});
