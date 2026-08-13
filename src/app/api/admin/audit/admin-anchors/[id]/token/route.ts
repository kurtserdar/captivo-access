import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const anchor = await db.adminAuditAnchor.findUnique({ where: { id }, select: { token: true, anchoredSeq: true } });
  if (!anchor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(Buffer.from(anchor.token), {
    headers: {
      "Content-Type": "application/timestamp-reply",
      "Content-Disposition": `attachment; filename="admin-anchor-seq-${anchor.anchoredSeq}.tsr"`,
    },
  });
}
