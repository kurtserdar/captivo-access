import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { buildTimeStampRequest, parseTimeStampResponse } from "./rfc3161";
import {
  resolvedExternalAnchorEnabled,
  resolvedAnchorTsaUrl,
  resolvedAnchorTsaAuth,
} from "@/lib/settings/platform";

// The preimage that gets timestamped: the chain position bound to its hash. Both
// the request (which timestamps sha256(preimage)) and verification (which needs
// the preimage to check the token's imprint) derive from this one definition.
export function anchorPreimage(anchoredSeq: bigint, anchoredHash: string): Buffer {
  return Buffer.from(`${anchoredSeq}:${anchoredHash}`, "utf8");
}

export function anchorDigest(anchoredSeq: bigint, anchoredHash: string): Buffer {
  return createHash("sha256").update(anchorPreimage(anchoredSeq, anchoredHash)).digest();
}

export function shouldAnchor(
  head: { lastSeq: bigint; lastHash: string },
  last: { anchoredSeq: bigint; anchoredHash: string } | null,
): boolean {
  if (head.lastSeq <= 0n) return false;
  if (!last) return true;
  return last.anchoredSeq !== head.lastSeq || last.anchoredHash !== head.lastHash;
}

export type AnchorRunResult =
  | { status: "disabled" }
  | { status: "skipped" }
  | { status: "anchored"; anchoredSeq: string; genTime: string }
  | { status: "failed"; error: string };

// runAnchor is fail-open: it returns a result object and never throws, so the
// cron handler always responds 200 and the next run retries.
export async function runAnchor(): Promise<AnchorRunResult> {
  try {
    if (!(await resolvedExternalAnchorEnabled())) return { status: "disabled" };
    const tsaUrl = await resolvedAnchorTsaUrl();
    if (tsaUrl === "") return { status: "disabled" };

    const head = await db.auditChainState.findUnique({
      where: { id: "singleton" },
      select: { lastSeq: true, lastHash: true },
    });
    if (!head) return { status: "skipped" };

    const last = await db.auditAnchor.findFirst({
      orderBy: { anchoredSeq: "desc" },
      select: { anchoredSeq: true, anchoredHash: true },
    });
    if (!shouldAnchor(head, last)) return { status: "skipped" };

    const digest = anchorDigest(head.lastSeq, head.lastHash);
    const req = buildTimeStampRequest(digest);

    const auth = await resolvedAnchorTsaAuth();
    const headers: Record<string, string> = { "Content-Type": "application/timestamp-query" };
    if (auth) headers.Authorization = "Basic " + Buffer.from(auth).toString("base64");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let der: Buffer;
    try {
      const res = await fetch(tsaUrl, {
        method: "POST",
        headers,
        body: new Uint8Array(req),
        signal: controller.signal,
      });
      if (!res.ok) return { status: "failed", error: `TSA HTTP ${res.status}` };
      der = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }

    const { token, genTime } = parseTimeStampResponse(der);
    await db.auditAnchor.create({
      data: { anchoredSeq: head.lastSeq, anchoredHash: head.lastHash, tsaUrl, token, genTime },
    });
    return { status: "anchored", anchoredSeq: head.lastSeq.toString(), genTime: genTime.toISOString() };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "unknown" };
  }
}
