import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

// Deletes a pending (unredeemed) connector pairing — used to clear stale or
// mistaken installs that never connected. Only unredeemed, unbound pairings can
// be deleted here (a redeemed pairing already produced a connector; a re-pair
// pairing belongs to an existing connector).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const pairing = await db.connectorPairing.findUnique({ where: { id }, select: { id: true, name: true, usedAt: true, connectorId: true } });
  if (!pairing || pairing.usedAt !== null || pairing.connectorId !== null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db.connectorPairing.delete({ where: { id } });
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "connector.pairing_delete",
    targetType: "connector_pairing", targetId: id,
    summary: `Deleted pending connector pairing "${pairing.name}"`,
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
}
