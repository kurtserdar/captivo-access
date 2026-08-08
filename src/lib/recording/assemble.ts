import { gunzipSync } from "node:zlib";

// Reverse of the ingest storage: order chunks by seq, gunzip each, JSON.parse,
// and concatenate into the full rrweb event array. A chunk that fails to
// decode/parse is skipped (a corrupt chunk must not break the whole replay).
export function assembleEvents(chunks: { seq: number; data: Buffer | Uint8Array }[]): unknown[] {
  const out: unknown[] = [];
  for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) {
    try {
      const parsed = JSON.parse(gunzipSync(Buffer.from(c.data)).toString("utf8"));
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      /* skip a corrupt chunk */
    }
  }
  return out;
}
