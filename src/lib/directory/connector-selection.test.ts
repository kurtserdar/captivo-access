import { describe, it, expect } from "vitest";
import { resolveConnectorChoice } from "./connector-selection";

const conns = [{ id: "a" }, { id: "b" }];

describe("resolveConnectorChoice", () => {
  it("keeps a saved id that still resolves", () => {
    expect(resolveConnectorChoice("b", conns)).toEqual({ value: "b", savedMissing: false });
  });

  it("flags a dangling saved id (deleted/revoked connector) and forces a re-pick", () => {
    expect(resolveConnectorChoice("gone", conns)).toEqual({ value: "", savedMissing: true });
  });

  it("convenience-defaults to the first connector when never configured", () => {
    expect(resolveConnectorChoice(null, conns)).toEqual({ value: "a", savedMissing: false });
    expect(resolveConnectorChoice("", conns)).toEqual({ value: "a", savedMissing: false });
  });

  it("does not warn when there are no connectors at all", () => {
    expect(resolveConnectorChoice(null, [])).toEqual({ value: "", savedMissing: false });
  });

  it("a dangling id with no connectors still flags missing", () => {
    expect(resolveConnectorChoice("gone", [])).toEqual({ value: "", savedMissing: true });
  });
});
