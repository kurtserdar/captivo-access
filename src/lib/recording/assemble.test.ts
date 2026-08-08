import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { assembleEvents } from "./assemble";

const chunk = (seq: number, events: unknown[]) => ({ seq, data: gzipSync(Buffer.from(JSON.stringify(events))) });

describe("assembleEvents", () => {
  it("orders by seq, gunzips, parses, and concatenates", () => {
    const out = assembleEvents([chunk(1, [{ n: 2 }, { n: 3 }]), chunk(0, [{ n: 0 }, { n: 1 }])]);
    expect(out).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }]);
  });
  it("returns [] for no chunks", () => {
    expect(assembleEvents([])).toEqual([]);
  });
});
