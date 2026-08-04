import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { canDeleteConnector } from "@/lib/connector/deletion";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const connector = await db.connector.findUnique({
    where: { id },
    select: { id: true, status: true, _count: { select: { sites: true } } },
  });
  if (!connector) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const check = canDeleteConnector({ status: connector.status, siteCount: connector._count.sites });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });

  await db.connector.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
