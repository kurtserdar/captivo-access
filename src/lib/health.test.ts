import { describe, it, expect } from "vitest";
import { getHealth } from "./health";

describe("getHealth", () => {
  it("returns status ok", () => {
    const h = getHealth();
    expect(h.status).toBe("ok");
    expect(typeof h.version).toBe("string");
  });
});
