import { timingSafeEqual } from "crypto";

// Constant-time string comparison for secrets/tokens taken from requests.
// Returns false on empty inputs or a length mismatch (length is the only thing
// this can leak, never content), otherwise compares in constant time so a
// network timing side-channel can't recover the secret byte by byte.
export function timingSafeEqualStr(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
