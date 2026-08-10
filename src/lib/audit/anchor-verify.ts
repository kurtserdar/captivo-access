import { anchorPreimage } from "./anchor";

export type AnchorInput = {
  id: string;
  anchoredSeq: bigint;
  anchoredHash: string;
  token: Buffer;
  genTime: Date;
};

export type AnchorVerdict = {
  id: string;
  anchoredSeq: string;
  genTime: string | null;
  ok: boolean;
  beyondRetention: boolean;
  reason: string | null;
};

export type VerifyDeps = {
  tokenCheck: (token: Buffer, preimage: Buffer) => Promise<{ ok: boolean; genTime: Date | null; reason?: string }>;
};

// verifyOneAnchor is pure given its deps. `chainHashAtSeq` is the hash of the
// AuditEvent currently at anchoredSeq, or null if that seq was retention-purged.
// It confirms two independent things: the token cryptographically attests
// (anchoredSeq, anchoredHash) at its genTime, AND the live chain still holds that
// hash at that position (so a later rewrite is caught).
export async function verifyOneAnchor(
  anchor: AnchorInput,
  chainHashAtSeq: string | null,
  deps: VerifyDeps,
): Promise<AnchorVerdict> {
  const preimage = anchorPreimage(anchor.anchoredSeq, anchor.anchoredHash);
  const tv = await deps.tokenCheck(anchor.token, preimage);
  const base = {
    id: anchor.id,
    anchoredSeq: anchor.anchoredSeq.toString(),
    genTime: (tv.genTime ?? anchor.genTime)?.toISOString() ?? null,
  };
  if (!tv.ok) {
    return { ...base, ok: false, beyondRetention: false, reason: `token_${tv.reason ?? "invalid"}` };
  }
  if (chainHashAtSeq === null) {
    return { ...base, ok: true, beyondRetention: true, reason: null };
  }
  if (chainHashAtSeq !== anchor.anchoredHash) {
    return { ...base, ok: false, beyondRetention: false, reason: "chain_mismatch" };
  }
  return { ...base, ok: true, beyondRetention: false, reason: null };
}
