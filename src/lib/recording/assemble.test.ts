import { describe, it, expect, beforeAll } from "vitest";
import { gzipSync } from "node:zlib";
import { assembleEvents } from "./assemble";
import { encryptBytes } from "@/lib/crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});

const legacyChunk = (seq: number, events: unknown[]) => ({ seq, data: gzipSync(Buffer.from(JSON.stringify(events))) });
const encChunk = (seq: number, events: unknown[]) => ({ seq, data: encryptBytes(gzipSync(Buffer.from(JSON.stringify(events)))) });

describe("assembleEvents", () => {
  it("legacy (unencrypted): orders by seq, gunzips, parses, concatenates", () => {
    const out = assembleEvents([legacyChunk(1, [{ n: 2 }, { n: 3 }]), legacyChunk(0, [{ n: 0 }, { n: 1 }])], false);
    expect(out).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }]);
  });
  it("encrypted: decrypts, gunzips, parses, concatenates", () => {
    const out = assembleEvents([encChunk(1, [{ n: 2 }]), encChunk(0, [{ n: 0 }, { n: 1 }])], true);
    expect(out).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
  });
  it("returns [] for no chunks", () => {
    expect(assembleEvents([], true)).toEqual([]);
  });
});
