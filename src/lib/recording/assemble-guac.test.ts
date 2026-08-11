import { describe, it, expect, beforeAll } from "vitest";
import { serializeGuacChunk, assembleGuac } from "./assemble-guac";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});

describe("assemble-guac", () => {
  it("round-trips a single chunk", () => {
    const raw = Buffer.from("4.size,4.1024,3.768,2.96;5.ready,4.$abc;");
    const stored = serializeGuacChunk(raw);
    expect(assembleGuac([{ seq: 0, data: stored }], true).equals(raw)).toBe(true);
  });

  it("concatenates chunks in seq order regardless of input order", () => {
    const a = Buffer.from("3.aaa;");
    const b = Buffer.from("3.bbb;");
    const c = Buffer.from("3.ccc;");
    const chunks = [
      { seq: 2, data: serializeGuacChunk(c) },
      { seq: 0, data: serializeGuacChunk(a) },
      { seq: 1, data: serializeGuacChunk(b) },
    ];
    expect(assembleGuac(chunks, true).equals(Buffer.concat([a, b, c]))).toBe(true);
  });

  it("skips a corrupt chunk instead of throwing", () => {
    const good = serializeGuacChunk(Buffer.from("3.xyz;"));
    const chunks = [
      { seq: 0, data: good },
      { seq: 1, data: Buffer.from("not encrypted garbage") },
    ];
    expect(assembleGuac(chunks, true).equals(Buffer.from("3.xyz;"))).toBe(true);
  });
});
