import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { saveDirectoryConfig, type DirectorySecurity } from "@/lib/directory/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asSecurity(v: unknown): DirectorySecurity {
  return v === "PLAIN" || v === "LDAPS" ? v : "STARTTLS";
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // The directory is reached through a connector. Reject an id that no longer
  // resolves (deleted) or is revoked, so we never persist a dangling reference
  // that would later fail every LDAP test with "connector offline".
  const connectorId = typeof body.connectorId === "string" && body.connectorId.trim() ? body.connectorId.trim() : null;
  if (connectorId) {
    const c = await db.connector.findFirst({ where: { id: connectorId, status: { not: "REVOKED" } }, select: { id: true } });
    if (!c) return NextResponse.json({ error: "connector_not_found" }, { status: 400 });
  }

  await saveDirectoryConfig({
    enabled: body.enabled === true,
    connectorId,
    host: typeof body.host === "string" ? body.host : "",
    port: typeof body.port === "number" ? body.port : Number(body.port) || 389,
    security: asSecurity(body.security),
    insecureSkipVerify: body.insecureSkipVerify === true,
    caCertPem: typeof body.caCertPem === "string" ? body.caCertPem : "",
    baseDN: typeof body.baseDN === "string" ? body.baseDN : "",
    bindDN: typeof body.bindDN === "string" ? body.bindDN : "",
    bindPassword: typeof body.bindPassword === "string" ? body.bindPassword : undefined,
  });
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "config.directory_update",
    summary: "Updated directory settings",
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true });
}
