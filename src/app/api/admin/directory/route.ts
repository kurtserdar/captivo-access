import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
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
  await saveDirectoryConfig({
    enabled: body.enabled === true,
    connectorId: typeof body.connectorId === "string" ? body.connectorId : null,
    host: typeof body.host === "string" ? body.host : "",
    port: typeof body.port === "number" ? body.port : Number(body.port) || 389,
    security: asSecurity(body.security),
    insecureSkipVerify: body.insecureSkipVerify === true,
    caCertPem: typeof body.caCertPem === "string" ? body.caCertPem : "",
    baseDN: typeof body.baseDN === "string" ? body.baseDN : "",
    bindDN: typeof body.bindDN === "string" ? body.bindDN : "",
    bindPassword: typeof body.bindPassword === "string" ? body.bindPassword : undefined,
  });
  return NextResponse.json({ ok: true });
}
