import { describe, it, expect } from "vitest";
import { normalizeDN, computeReconcile, planGrantChanges, type MappingLite } from "./reconcile";

const roleMap = (groupDN: string, role: "ADMIN" | "OPERATOR" | "AUDITOR"): MappingLite =>
  ({ kind: "ROLE", groupDN, role, enabled: true });
const siteMap = (groupDN: string, siteId: string): MappingLite =>
  ({ kind: "SITE", groupDN, siteId, enabled: true });

describe("normalizeDN", () => {
  it("lowercases and strips spaces after commas", () => {
    expect(normalizeDN("CN=Admins, OU=Groups, DC=corp,DC=local")).toBe("cn=admins,ou=groups,dc=corp,dc=local");
  });
});

describe("computeReconcile", () => {
  const admins = "CN=Captivo-Admins,OU=Groups,DC=corp,DC=local";
  const viewers = "CN=Captivo-Viewers,OU=Groups,DC=corp,DC=local";
  const dbGroup = "CN=DB-Ops,OU=Groups,DC=corp,DC=local";

  it("picks the highest console role among matched ROLE mappings", () => {
    const d = computeReconcile([admins, viewers], [roleMap(admins, "OPERATOR"), roleMap(viewers, "AUDITOR")], { directoryManaged: true });
    expect(d).toEqual({ deprovision: false, role: "OPERATOR", grantSiteIds: [] });
  });

  it("matches DNs case-insensitively and ignoring comma spacing", () => {
    const d = computeReconcile(["cn=captivo-admins, ou=groups, dc=corp, dc=local"], [roleMap(admins, "ADMIN")], { directoryManaged: false });
    expect(d.role).toBe("ADMIN");
  });

  it("falls back to STAFF when only SITE mappings match", () => {
    const d = computeReconcile([dbGroup], [siteMap(dbGroup, "site_1")], { directoryManaged: true });
    expect(d).toEqual({ deprovision: false, role: "STAFF", grantSiteIds: ["site_1"] });
  });

  it("unions distinct site ids and keeps the highest role together", () => {
    const d = computeReconcile([admins, dbGroup], [roleMap(admins, "ADMIN"), siteMap(dbGroup, "site_1"), siteMap(admins, "site_1")], { directoryManaged: true });
    expect(d.role).toBe("ADMIN");
    expect(d.grantSiteIds.sort()).toEqual(["site_1"]);
  });

  it("ignores disabled mappings", () => {
    const d = computeReconcile([admins], [{ ...roleMap(admins, "ADMIN"), enabled: false }], { directoryManaged: true });
    expect(d.deprovision).toBe(true);
    expect(d.role).toBeNull();
  });

  it("deprovisions a directory-managed user in no mapped group", () => {
    expect(computeReconcile([], [roleMap(admins, "ADMIN")], { directoryManaged: true }))
      .toEqual({ deprovision: true, role: null, grantSiteIds: [] });
  });

  it("no-ops a local user in no mapped group", () => {
    expect(computeReconcile([], [roleMap(admins, "ADMIN")], { directoryManaged: false }))
      .toEqual({ deprovision: false, role: null, grantSiteIds: [] });
  });
});

describe("planGrantChanges", () => {
  it("creates missing and revokes surplus directory grants", () => {
    expect(planGrantChanges(["a", "b"], ["b", "c"])).toEqual({ toCreateSiteIds: ["c"], toRevokeSiteIds: ["a"] });
  });
  it("no changes when equal", () => {
    expect(planGrantChanges(["a"], ["a"])).toEqual({ toCreateSiteIds: [], toRevokeSiteIds: [] });
  });
});

describe("computeReconcile — bare group name (CN) matching", () => {
  const adminsDN = "CN=Captivo-Admins,OU=Groups,DC=corp,DC=local";

  it("matches a bare group name against the CN of a full memberOf DN", () => {
    const d = computeReconcile([adminsDN], [roleMap("Captivo-Admins", "ADMIN")], { directoryManaged: true });
    expect(d.role).toBe("ADMIN");
  });

  it("bare-name match is case-insensitive", () => {
    const d = computeReconcile([adminsDN], [roleMap("captivo-admins", "OPERATOR")], { directoryManaged: true });
    expect(d.role).toBe("OPERATOR");
  });

  it("a full DN still matches exactly (not treated as a bare name)", () => {
    const d = computeReconcile([adminsDN], [roleMap(adminsDN, "AUDITOR")], { directoryManaged: true });
    expect(d.role).toBe("AUDITOR");
  });

  it("a bare name that isn't the CN does not match", () => {
    const d = computeReconcile([adminsDN], [roleMap("Some-Other-Group", "ADMIN")], { directoryManaged: true });
    expect(d.role).toBeNull();
  });
})
