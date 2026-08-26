import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [rows, unread] = await Promise.all([
    db.notification.findMany({
      where: { readAt: null },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, siteName: true, detail: true, createdAt: true },
    }),
    db.notification.count({ where: { readAt: null } }),
  ]);

  return NextResponse.json({
    items: rows.map((n) => ({ id: n.id, type: n.type, siteName: n.siteName ?? "—", detail: n.detail, when: timeAgo(n.createdAt) })),
    unread,
  });
}
