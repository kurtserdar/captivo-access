import { gzipSync, gunzipSync } from "node:zlib";
import { encryptBytes, decryptBytes } from "@/lib/crypto";

// One stored RecordingChunk for a GUAC recording = encryptBytes(gzip(raw guac
// instruction bytes)). Keep this the single definition of the on-disk format so
// the ingest writer and the replay reader can never drift.
export function serializeGuacChunk(raw: Buffer): Buffer {
  return encryptBytes(gzipSync(raw));
}

// Reverse of serializeGuacChunk across a whole recording: order chunks by seq,
// (decrypt if the recording is encrypted) + gunzip each, and concatenate the raw
// guac instruction bytes into one Buffer. A chunk that fails to decode is skipped
// — a single corrupt chunk must never break the whole replay.
export function assembleGuac(
  chunks: { seq: number; data: Buffer | Uint8Array }[],
  encrypted: boolean,
): Buffer {
  const parts: Buffer[] = [];
  for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) {
    try {
      const buf = Buffer.from(c.data);
      const gz = encrypted ? decryptBytes(buf) : buf;
      parts.push(gunzipSync(gz));
    } catch {
      /* skip a corrupt chunk */
    }
  }
  return Buffer.concat(parts);
}
