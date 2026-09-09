import { describe, it, expect, vi, afterEach } from "vitest";
import { deriveTunnelUrl, isLocalManagerUrl, managerBaseUrlFromHeaders } from "./url";

describe("deriveTunnelUrl", () => {
  it("swaps manager.<domain> → connect.<domain> and https → wss", () => {
    expect(deriveTunnelUrl("https://manager.access.example.com")).toBe("wss://connect.access.example.com");
  });

  it("uses ws for an http manager URL", () => {
    expect(deriveTunnelUrl("http://manager.access.example.com")).toBe("ws://connect.access.example.com");
  });

  it("tolerates a trailing slash / path", () => {
    expect(deriveTunnelUrl("https://manager.access.example.com/")).toBe("wss://connect.access.example.com");
  });

  it("returns null for a custom port (e.g. the dev localhost URL)", () => {
    expect(deriveTunnelUrl("http://localhost:3100")).toBeNull();
    expect(deriveTunnelUrl("https://manager.access.example.com:8443")).toBeNull();
  });

  it("returns null when the host has no manager. prefix", () => {
    expect(deriveTunnelUrl("https://access.example.com")).toBeNull();
    expect(deriveTunnelUrl("https://app.example.com")).toBeNull();
  });

  it("returns null for missing or unparseable input", () => {
    expect(deriveTunnelUrl(undefined)).toBeNull();
    expect(deriveTunnelUrl("")).toBeNull();
    expect(deriveTunnelUrl("not a url")).toBeNull();
  });
});

describe("isLocalManagerUrl", () => {
  it("is true for localhost / 127.0.0.1 / [::1], with or without a port", () => {
    expect(isLocalManagerUrl("http://localhost:3100")).toBe(true);
    expect(isLocalManagerUrl("https://127.0.0.1/")).toBe(true);
    expect(isLocalManagerUrl("http://[::1]:3100")).toBe(true);
  });
  it("is false for a real public manager URL", () => {
    expect(isLocalManagerUrl("https://manager.access.captivo.io")).toBe(false);
    expect(isLocalManagerUrl("https://manager.access.example.com/")).toBe(false);
  });
});

describe("managerBaseUrlFromHeaders", () => {
  const H = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("self-host: MANAGER_PUBLIC_URL wins over the request host", () => {
    vi.stubEnv("MULTI_TENANT", "0");
    vi.stubEnv("MANAGER_PUBLIC_URL", "https://manager.access.example.com/");
    expect(managerBaseUrlFromHeaders(H({ host: "manager.access.example.com" }))).toBe("https://manager.access.example.com");
  });

  it("self-host without MANAGER_PUBLIC_URL: derives from forwarded headers", () => {
    vi.stubEnv("MULTI_TENANT", "0");
    vi.stubEnv("MANAGER_PUBLIC_URL", "");
    expect(managerBaseUrlFromHeaders(H({ "x-forwarded-host": "m.example.com", "x-forwarded-proto": "https" }))).toBe("https://m.example.com");
    expect(managerBaseUrlFromHeaders(H({}), { fallbackOrigin: "http://abc:3100" })).toBe("http://abc:3100");
  });

  it("cloud: a tenant console host is its own base (not the platform MANAGER_PUBLIC_URL)", () => {
    vi.stubEnv("MULTI_TENANT", "1");
    vi.stubEnv("CONSOLE_DOMAIN", "cloud.example.com");
    vi.stubEnv("MANAGER_PUBLIC_URL", "https://platform.cloud.example.com");
    expect(managerBaseUrlFromHeaders(H({ "x-forwarded-host": "acme.cloud.example.com", "x-forwarded-proto": "https" }))).toBe("https://acme.cloud.example.com");
    // the platform host itself is a console host too → same value as configured
    expect(managerBaseUrlFromHeaders(H({ "x-forwarded-host": "platform.cloud.example.com", "x-forwarded-proto": "https" }))).toBe("https://platform.cloud.example.com");
  });

  it("cloud: a non-console host (custom domain, site host) falls back to MANAGER_PUBLIC_URL", () => {
    vi.stubEnv("MULTI_TENANT", "1");
    vi.stubEnv("CONSOLE_DOMAIN", "cloud.example.com");
    vi.stubEnv("MANAGER_PUBLIC_URL", "https://platform.cloud.example.com");
    expect(managerBaseUrlFromHeaders(H({ "x-forwarded-host": "portal.acme.com", "x-forwarded-proto": "https" }))).toBe("https://platform.cloud.example.com");
    expect(managerBaseUrlFromHeaders(H({ "x-forwarded-host": "captivo.acme.cloud.example.com" }))).toBe("https://platform.cloud.example.com");
  });
});
