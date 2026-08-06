import { describe, it, expect } from "vitest";
import { can, isConsoleUser, ASSIGNABLE_ROLES, ROLE_LABELS } from "./roles";

describe("can()", () => {
  const table: Array<[Parameters<typeof can>[0], boolean, boolean, boolean]> = [
    // role,      configure, approve_grants, read_console
    ["ADMIN",     true,      true,           true],
    ["OPERATOR",  false,     true,           true],
    ["AUDITOR",   false,     false,          true],
    ["STAFF",     false,     false,          false],
    ["VENDOR",    false,     false,          false],
  ];
  it.each(table)("%s capabilities", (role, configure, approve, read) => {
    expect(can(role, "configure")).toBe(configure);
    expect(can(role, "approve_grants")).toBe(approve);
    expect(can(role, "read_console")).toBe(read);
  });
});

describe("isConsoleUser()", () => {
  it.each([
    ["ADMIN", true],
    ["OPERATOR", true],
    ["AUDITOR", true],
    ["STAFF", false],
    ["VENDOR", false],
  ] as const)("%s", (role, expected) => {
    expect(isConsoleUser(role)).toBe(expected);
  });
});

describe("assignable roles + labels", () => {
  it("offers all five roles for assignment", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["ADMIN", "OPERATOR", "AUDITOR", "STAFF", "VENDOR"]);
  });
  it("has an English label for every role", () => {
    for (const r of ASSIGNABLE_ROLES) expect(ROLE_LABELS[r]).toBeTruthy();
  });
});
