import { describe, it, expect } from "vitest";
import { sessionTtlMs, idleExpired, evictionIds } from "./session-policy";

describe("sessionTtlMs", () => {
  it("policy hours win when set, else env", () => {
    expect(sessionTtlMs(2, 12)).toBe(2 * 3600_000);
    expect(sessionTtlMs(null, 12)).toBe(12 * 3600_000);
    expect(sessionTtlMs(0, 12)).toBe(12 * 3600_000);
  });
});
describe("idleExpired", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  it("true past the window, false within, false when unset", () => {
    expect(idleExpired(new Date("2026-01-01T11:50:00Z"), now, 5)).toBe(true);
    expect(idleExpired(new Date("2026-01-01T11:58:00Z"), now, 5)).toBe(false);
    expect(idleExpired(new Date("2026-01-01T10:00:00Z"), now, null)).toBe(false);
    expect(idleExpired(new Date("2026-01-01T10:00:00Z"), now, 0)).toBe(false);
  });
});
describe("evictionIds", () => {
  const s = (id: string) => ({ id });
  it("evicts oldest to keep cap after one insert", () => {
    expect(evictionIds([s("a"), s("b"), s("c")], 2)).toEqual(["a", "b"]);
    expect(evictionIds([s("a")], 2)).toEqual([]);
    expect(evictionIds([s("a"), s("b")], null)).toEqual([]);
    expect(evictionIds([s("a"), s("b")], 0)).toEqual([]);
  });
});
