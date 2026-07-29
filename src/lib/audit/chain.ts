import { createHash } from "node:crypto";

// Fields that are part of the attested record, in FROZEN order. `id` and
// `createdAt` are DB-local bookkeeping and are intentionally excluded.
export type ChainableEvent = {
  seq: bigint;
  timestamp: Date;
  userId: string | null;
  siteId: string | null;
  host: string;
  method: string;
  path: string;
  status: number;
  bytesOut: bigint;
  decision: string;
  reason: string | null;
  clientIp: string | null;
  userAgent: string | null;
};

// Unit separator — a byte that never appears in the field values, so the
// concatenation is unambiguous.
const US = "\x1f";

export const GENESIS_PREV_HASH = "";

// Fixed 64-bit key for pg_advisory_xact_lock. Derived once from
// sha256("captivo-access:audit-chain") first 8 bytes as a signed bigint.
export const AUDIT_CHAIN_LOCK_KEY = 6011971385529861010n;

export function canonicalize(e: ChainableEvent): string {
  return [
    e.seq.toString(),
    e.timestamp.toISOString(),
    e.userId ?? "",
    e.siteId ?? "",
    e.host,
    e.method,
    e.path,
    String(e.status),
    e.bytesOut.toString(),
    e.decision,
    e.reason ?? "",
    e.clientIp ?? "",
    e.userAgent ?? "",
  ].join(US);
}

export function computeHash(prevHash: string, e: ChainableEvent): string {
  return createHash("sha256").update(prevHash + "\n" + canonicalize(e)).digest("hex");
}
