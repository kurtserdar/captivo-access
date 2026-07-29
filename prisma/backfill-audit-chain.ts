// One-time: seal existing AuditEvent rows into the tamper-evidence hash-chain.
// Run once after `prisma db push` adds the seq/prevHash/hash columns.
//   DATABASE_URL=... pnpm exec tsx prisma/backfill-audit-chain.ts [--force]
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { computeHash, GENESIS_PREV_HASH, AUDIT_CHAIN_LOCK_KEY, type ChainableEvent } from "../src/lib/audit/chain";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const force = process.argv.includes("--force");

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;

    const head = await tx.auditChainState.findUnique({ where: { id: "singleton" } });
    if (head && head.lastSeq > 0n && !force) {
      throw new Error(`Chain already established (lastSeq=${head.lastSeq}). Re-run with --force to rebuild.`);
    }

    // Stable total order for events that predate the chain.
    const rows = await tx.auditEvent.findMany({
      orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true, timestamp: true, userId: true, siteId: true, host: true,
        method: true, path: true, status: true, bytesOut: true, decision: true,
        reason: true, clientIp: true, userAgent: true,
      },
    });

    // NOTE on --force reruns: this loop reassigns `seq` row-by-row in the
    // stable order above. If that recomputed order differs from the seq
    // values already stored on the rows (e.g. a previous backfill run, or
    // any other seq assignment), an intermediate `update` here can
    // transiently collide with the `@unique` index on `seq` mid-transaction
    // even though the final assignment is consistent. The safe operator
    // procedure for a real rebuild is to clear the existing `seq` values (or
    // wipe the chain) first, rather than relying on --force alone.
    let seq = 0n;
    let prevHash = GENESIS_PREV_HASH;
    for (const r of rows) {
      seq += 1n;
      const e: ChainableEvent = { ...r, seq };
      const hash = computeHash(prevHash, e);
      await tx.auditEvent.update({ where: { id: r.id }, data: { seq, prevHash, hash } });
      prevHash = hash;
    }

    await tx.auditChainState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastSeq: seq, lastHash: prevHash },
      update: { lastSeq: seq, lastHash: prevHash },
    });

    console.log(`Backfilled ${rows.length} events; chain head at seq=${seq}.`);
  }, { timeout: 120_000 });
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
