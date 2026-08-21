import { decryptBytes } from "@/lib/crypto";

// Cap on how many non-masked keystroke events a single command search will
// decrypt. Above this the caller returns a "narrow your filters" signal rather
// than scanning — keeps search fast and bounded on a large corpus.
export const COMMAND_SCAN_CAP = 50_000;

// Case-insensitive substring. Empty query never matches (avoids "match all").
export function commandTextMatches(decrypted: string, query: string): boolean {
  if (!query) return false;
  return decrypted.toLowerCase().includes(query.toLowerCase());
}

// Decrypt each event's text and collect the recordingKeys that match. A row that
// fails to decrypt is skipped (never throws) — one corrupt chunk can't break the
// whole search. Callers pass only non-masked events.
export function scanDecryptedMatches(
  events: { recordingKey: string; data: Uint8Array }[],
  query: string,
): Set<string> {
  const hits = new Set<string>();
  for (const e of events) {
    if (hits.has(e.recordingKey)) continue; // already matched this recording
    let text: string;
    try {
      text = decryptBytes(Buffer.from(e.data)).toString("utf8");
    } catch {
      continue;
    }
    if (commandTextMatches(text, query)) hits.add(e.recordingKey);
  }
  return hits;
}
