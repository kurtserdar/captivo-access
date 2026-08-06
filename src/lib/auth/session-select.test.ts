import { describe, it, expect } from "vitest";
import { sessionIdsToRevoke } from "./session-select";

describe("sessionIdsToRevoke", () => {
  it("drops the caller's own current session id", () => {
    expect(sessionIdsToRevoke(["a", "b", "self"], "self")).toEqual(["a", "b"]);
  });
  it("keeps all when current id is not in the list", () => {
    expect(sessionIdsToRevoke(["a", "b"], "self")).toEqual(["a", "b"]);
  });
  it("keeps all when there is no current id", () => {
    expect(sessionIdsToRevoke(["a", "b"], null)).toEqual(["a", "b"]);
  });
  it("drops empty/non-string entries", () => {
    expect(sessionIdsToRevoke(["a", "", "b"], null)).toEqual(["a", "b"]);
  });
});
