import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { pushConnectorPolicy } from "@/lib/connector/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clears every connector's explicit log level (-> null = inherit the fleet
// default) and pushes the now-default level live to non-revoked connectors.
export async function POST() {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const updated = await db.connector.updateMany({ where: { logLevel: { not: null } }, data: { logLevel: null } });
  const connectors = await db.connector.findMany({ where: { status: { not: "REVOKED" } }, select: { id: true } });
  await Promise.all(connectors.map((c) => pushConnectorPolicy(c.id).catch(() => null)));

  return NextResponse.json({ ok: true, count: updated.count });
}
