import { describe, it, expect } from "vitest";
import { adminActionLabel } from "./admin-actions";

describe("adminActionLabel", () => {
  it("maps known actions to human labels", () => {
    expect(adminActionLabel("session.terminate")).toBe("Session terminated");
    expect(adminActionLabel("grant.update")).toBe("Grant updated");
    expect(adminActionLabel("resource.vault_update")).toBe("Resource credential updated");
  });
  it("falls back to the raw action for unknown values", () => {
    expect(adminActionLabel("something.new")).toBe("something.new");
  });
});
