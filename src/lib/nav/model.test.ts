import { describe, it, expect } from "vitest";
import { buildNavModel } from "./model";

describe("buildNavModel", () => {
  it("ADMIN: full primary + both groups + badges", () => {
    const m = buildNavModel("ADMIN", { pending: 3, unread: 5 });
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Recordings", "Audit", "Insights"]);
    expect(m.primary.find((i) => i.label === "Access")?.badge).toBe(3);
    expect(m.groups.map((g) => g.label)).toEqual(["Infrastructure", "People"]);
    expect(m.groups[0].items).toHaveLength(8);
    expect(m.groups[1].items.map((i) => i.href)).toEqual(["/admin/users", "/admin/invites", "/admin/sessions"]);
    expect(m.showSearch).toBe(true);
    expect(m.showNotifications).toBe(true);
    expect(m.notificationsBadge).toBe(5);
  });
  it("OPERATOR: read-console + grants badge, no config groups, no Recordings", () => {
    const m = buildNavModel("OPERATOR", { pending: 2, unread: 0 });
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Audit", "Insights"]);
    expect(m.primary.find((i) => i.label === "Access")?.badge).toBe(2);
    expect(m.groups).toEqual([]);
    expect(m.showSearch).toBe(true);
  });
  it("AUDITOR: read-console, no grants badge, no config groups", () => {
    const m = buildNavModel("AUDITOR", { pending: 9, unread: 1 });
    expect(m.primary.map((i) => i.label)).toEqual(["Console", "Access", "Sessions", "Audit", "Insights"]);
    expect(m.primary.find((i) => i.label === "Access")?.badge).toBeUndefined();
    expect(m.groups).toEqual([]);
    expect(m.notificationsBadge).toBe(1);
  });
  it("VENDOR: empty (never in console)", () => {
    const m = buildNavModel("VENDOR", { pending: 0, unread: 0 });
    expect(m.primary).toEqual([]);
    expect(m.groups).toEqual([]);
    expect(m.showSearch).toBe(false);
    expect(m.showNotifications).toBe(false);
  });
});
