import { describe, it, expect, beforeAll } from "vitest";
import { commandTextMatches, scanDecryptedMatches } from "./command-search";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});

describe("commandTextMatches", () => {
  it("matches case-insensitive substring", () => {
    expect(commandTextMatches("sudo systemctl restart nginx", "SYSTEMCTL")).toBe(true);
    expect(commandTextMatches("ls -la", "rm")).toBe(false);
  });
  it("empty query never matches", () => {
    expect(commandTextMatches("anything", "")).toBe(false);
  });
});

describe("scanDecryptedMatches", () => {
  it("returns recordingKeys whose decrypted text contains the query", async () => {
    const { encryptBytes } = await import("@/lib/crypto");
    const enc = (s: string) => new Uint8Array(encryptBytes(Buffer.from(s, "utf8")));
    const events = [
      { recordingKey: "recA", data: enc("rm -rf /tmp/x") },
      { recordingKey: "recB", data: enc("ls -la") },
      { recordingKey: "recA", data: enc("whoami") },
    ];
    const hits = scanDecryptedMatches(events, "rm -rf");
    expect([...hits]).toEqual(["recA"]);
  });
  it("skips undecryptable rows without throwing", () => {
    const hits = scanDecryptedMatches([{ recordingKey: "bad", data: new Uint8Array([1, 2, 3]) }], "x");
    expect(hits.size).toBe(0);
  });
});
