import { describe, it, expect } from "vitest";
import { validateSiteInput } from "./validate";

const base = { nativeGateway: true, requireSecret: true, recordingEnabled: true, isolationEnabled: true };

describe("validateSiteInput", () => {
  it("web app needs hostname + upstream", () => {
    const r = validateSiteInput({ accessMode: "TRANSPARENT", connectorId: "c", name: "n", hostname: "", upstreamUrl: "" }, base);
    expect(r).toMatchObject({ ok: false });
  });
  it("web app ok returns normalized fields", () => {
    const r = validateSiteInput({ accessMode: "TRANSPARENT", connectorId: "c", name: "n", hostname: "APP.x.io", upstreamUrl: "http://10.0.0.5:80", recordSessions: true }, base);
    expect(r).toMatchObject({ ok: true, mode: "TRANSPARENT", hostname: "app.x.io", recordSessions: true });
  });
  it("web app rejects a non-http upstream", () => {
    const r = validateSiteInput({ accessMode: "TRANSPARENT", connectorId: "c", name: "n", hostname: "a.x", upstreamUrl: "ftp://x" }, base);
    expect(r).toMatchObject({ ok: false, error: "invalid_upstream_url" });
  });
  it("remote desktop needs protocol/host/port/username/secret", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "RDP", targetHost: "", targetPort: 0, username: "", secret: "" }, base);
    expect(r).toMatchObject({ ok: false });
  });
  it("remote desktop ok returns the target", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "rdp", targetHost: "10.0.0.5", targetPort: 3389, username: "adm", secret: "pw" }, base);
    expect(r).toMatchObject({ ok: true, mode: "GATEWAY", protocol: "RDP", targetHost: "10.0.0.5", targetPort: 3389, username: "adm", secret: "pw" });
  });
  it("remote desktop carries recordSessions (native gateway recording)", () => {
    const on = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "RDP", targetHost: "h", targetPort: 3389, username: "u", secret: "s", recordSessions: true }, base);
    expect(on).toMatchObject({ ok: true, mode: "GATEWAY", recordSessions: true });
    const off = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "RDP", targetHost: "h", targetPort: 3389, username: "u", secret: "s", recordSessions: true }, { ...base, recordingEnabled: false });
    expect(off).toMatchObject({ ok: true, mode: "GATEWAY", recordSessions: false });
  });
  it("remote desktop rejected when native gateway is off", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "RDP", targetHost: "h", targetPort: 3389, username: "u", secret: "s" }, { ...base, nativeGateway: false });
    expect(r).toMatchObject({ ok: false, error: "native_gateway_disabled" });
  });
  it("remote desktop update may omit the secret (requireSecret false)", () => {
    const r = validateSiteInput({ accessMode: "GATEWAY", connectorId: "c", name: "n", protocol: "SSH", targetHost: "h", targetPort: 22, username: "u", secret: "" }, { ...base, requireSecret: false });
    expect(r).toMatchObject({ ok: true, secret: null });
  });
  it("ISOLATED: requires upstreamUrl, no hostname/vault, gated", () => {
    const b = { connectorId: "c1", name: "Wiki", accessMode: "ISOLATED", upstreamUrl: "https://wiki.internal" };
    expect(validateSiteInput(b, { ...base, isolationEnabled: false }))
      .toEqual({ ok: false, error: "isolation_disabled" });
    expect(validateSiteInput(b, { ...base, isolationEnabled: true }))
      .toMatchObject({ ok: true, mode: "ISOLATED", connectorId: "c1", name: "Wiki", upstreamUrl: "https://wiki.internal" });
    expect(validateSiteInput({ ...b, upstreamUrl: "ftp://x" }, { ...base, isolationEnabled: true }))
      .toEqual({ ok: false, error: "invalid_upstream_url" });
    expect(validateSiteInput({ ...b, upstreamUrl: "" }, { ...base, isolationEnabled: true }))
      .toEqual({ ok: false, error: "isolated_url_required" });
    expect(validateSiteInput({ ...b, isolationHiFi: true }, { ...base, isolationEnabled: true }))
      .toMatchObject({ ok: true, mode: "ISOLATED", isolationHiFi: true });
  });
});
