import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Control the request host.
let mockHost = "";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-host", mockHost]]) as unknown as Headers,
}));

// Keep slugFromHost real (the logic under test); stub the DB resolver to echo the
// slug it was given so we can assert which slug was extracted.
vi.mock("@/lib/tenant/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant/resolve")>("@/lib/tenant/resolve");
  return { ...actual, resolveTenantBySlug: vi.fn(async (slug: string) => `tid:${slug}`) };
});

import { resolveRequestTenant } from "./request";

const ENV = { ...process.env };
beforeEach(() => {
  delete process.env.CONSOLE_DOMAIN;
  delete process.env.ACCESS_DOMAIN;
  delete process.env.MANAGER_PUBLIC_URL;
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("resolveRequestTenant CONSOLE_DOMAIN", () => {
  it("resolves a tenant slug under CONSOLE_DOMAIN", async () => {
    process.env.CONSOLE_DOMAIN = "cloud.captivo.io";
    mockHost = "acme.cloud.captivo.io";
    expect(await resolveRequestTenant()).toBe("tid:acme");
  });

  it("returns null for a multi-label site host under the console domain", async () => {
    process.env.CONSOLE_DOMAIN = "cloud.captivo.io";
    mockHost = "printer.sites.cloud.captivo.io"; // multi-label → not a console slug
    expect(await resolveRequestTenant()).toBeNull();
  });

  it("falls back to the access domain when CONSOLE_DOMAIN is unset", async () => {
    process.env.ACCESS_DOMAIN = "access.example.com";
    mockHost = "acme.access.example.com";
    expect(await resolveRequestTenant()).toBe("tid:acme");
  });

  it("returns null when neither domain matches the host", async () => {
    process.env.CONSOLE_DOMAIN = "cloud.captivo.io";
    mockHost = "acme.other.example.com";
    expect(await resolveRequestTenant()).toBeNull();
  });
});
