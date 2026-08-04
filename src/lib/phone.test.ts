import { describe, it, expect } from "vitest";
import { composePhone } from "./phone";

describe("composePhone", () => {
  it("blank national -> empty string", () => expect(composePhone("+90", "")).toBe(""));
  it("whitespace national -> empty string", () => expect(composePhone("+90", "   ")).toBe(""));
  it("composes dial + trimmed national", () => expect(composePhone("+90", "  532 123 45 67 ")).toBe("+90 532 123 45 67"));
});
