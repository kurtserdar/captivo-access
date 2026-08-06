import { describe, it, expect } from "vitest";
import { filterUsers } from "./filter-users";

const users = [
  { name: "Dana Vendor", email: "dana@contractor.example", status: "ACTIVE", role: "VENDOR" },
  { name: "Alice Admin", email: "alice@acme.com", status: "ACTIVE", role: "ADMIN" },
  { name: "Bob Staff", email: "bob@acme.com", status: "DISABLED", role: "STAFF" },
];

describe("filterUsers", () => {
  it("returns all with an empty query and 'all' filters", () => {
    expect(filterUsers(users, { q: "", status: "all", role: "all" })).toHaveLength(3);
  });
  it("matches name case-insensitively", () => {
    expect(filterUsers(users, { q: "dana", status: "all", role: "all" }).map((u) => u.name)).toEqual(["Dana Vendor"]);
  });
  it("matches email substring case-insensitively", () => {
    expect(filterUsers(users, { q: "ACME.com", status: "all", role: "all" }).map((u) => u.email)).toEqual(["alice@acme.com", "bob@acme.com"]);
  });
  it("filters by status", () => {
    expect(filterUsers(users, { q: "", status: "DISABLED", role: "all" }).map((u) => u.name)).toEqual(["Bob Staff"]);
  });
  it("filters by role", () => {
    expect(filterUsers(users, { q: "", status: "all", role: "ADMIN" }).map((u) => u.name)).toEqual(["Alice Admin"]);
  });
  it("combines query + status + role", () => {
    expect(filterUsers(users, { q: "acme", status: "ACTIVE", role: "ADMIN" }).map((u) => u.name)).toEqual(["Alice Admin"]);
  });
  it("returns [] when nothing matches", () => {
    expect(filterUsers(users, { q: "zzz", status: "all", role: "all" })).toEqual([]);
  });
});
