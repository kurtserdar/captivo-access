import { describe, it, expect } from "vitest";
import { filterCommandItems, type CommandItem } from "./command";

const items: CommandItem[] = [
  { id: "page:/", label: "Overview", sub: null, href: "/", group: "Pages" },
  { id: "page:/admin/users", label: "Users", sub: null, href: "/admin/users", group: "Pages" },
  { id: "site:1", label: "Grafana", sub: "graf.internal", href: "/admin/sites", group: "Sites" },
  { id: "user:1", label: "Ayse", sub: "ayse@x.com", href: "/admin/users", group: "Users" },
];

describe("filterCommandItems", () => {
  it("empty query returns only Pages", () => {
    expect(filterCommandItems("", items).map((i) => i.id)).toEqual(["page:/", "page:/admin/users"]);
  });
  it("matches label, case-insensitive", () => {
    expect(filterCommandItems("GRAF", items).map((i) => i.id)).toEqual(["site:1"]);
  });
  it("matches sub (email/hostname)", () => {
    expect(filterCommandItems("ayse@", items).map((i) => i.id)).toEqual(["user:1"]);
  });
  it("preserves input order (pages before records)", () => {
    // "s" matches "Users" (Pages) and "Ayse"/"ayse@x.com" (Users group) — not Grafana/graf.internal,
    // which contain no "s". The result order still reflects input order (Pages item first).
    expect(filterCommandItems("s", items).map((i) => i.group)).toEqual(["Pages", "Users"]);
  });
  it("respects the cap", () => {
    const many: CommandItem[] = Array.from({ length: 20 }, (_, n) => ({ id: `s:${n}`, label: `node ${n}`, sub: null, href: "/admin/sites", group: "Sites" }));
    expect(filterCommandItems("node", many, 5)).toHaveLength(5);
  });
});
