import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { verifyTimeStampToken } from "@/lib/audit/rfc3161";
import { verifyOneAnchor } from "@/lib/audit/anchor-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const anchors = await db.auditAnchor.findMany({
    orderBy: { anchoredSeq: "asc" },
    select: { id: true, anchoredSeq: true, anchoredHash: true, token: true, genTime: true },
  });

  const verdicts = [];
  for (const a of anchors) {
    const event = await db.auditEvent.findUnique({ where: { seq: a.anchoredSeq }, select: { hash: true } });
    verdicts.push(
      await verifyOneAnchor(
        {
          id: a.id,
          anchoredSeq: a.anchoredSeq,
          anchoredHash: a.anchoredHash,
          token: Buffer.from(a.token),
          genTime: a.genTime,
        },
        event ? event.hash : null,
        { tokenCheck: verifyTimeStampToken },
      ),
    );
  }

  const okCount = verdicts.filter((v) => v.ok).length;
  return NextResponse.json({ total: verdicts.length, ok: okCount, failed: verdicts.length - okCount, verdicts });
}
