import { describe, it, expect } from "vitest";
import { deriveTunnelUrl, isLocalManagerUrl } from "./url";

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
