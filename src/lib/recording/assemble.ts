import { gunzipSync } from "node:zlib";
import { decryptBytes } from "@/lib/crypto";

// Reverse of the ingest storage: order chunks by seq, (decrypt if the recording is
// encrypted) + gunzip each, JSON.parse, and concatenate into the full rrweb event
// array. A chunk that fails to decode/parse is skipped (a corrupt chunk must not
// break the whole replay). `encrypted` reflects SessionRecording.encrypted, so
// legacy unencrypted recordings still replay.
export function assembleEvents(chunks: { seq: number; data: Buffer | Uint8Array }[], encrypted: boolean): unknown[] {
  const out: unknown[] = [];
  for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) {
    try {
      const buf = Buffer.from(c.data);
      const gz = encrypted ? decryptBytes(buf) : buf;
      const parsed = JSON.parse(gunzipSync(gz).toString("utf8"));
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      /* skip a corrupt chunk */
    }
  }
  return out;
}
