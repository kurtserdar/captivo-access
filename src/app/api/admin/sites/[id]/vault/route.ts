import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { vaultEnabled } from "@/lib/vault/enabled";
import { setVaultCredential, clearVaultCredential } from "@/lib/vault/store";
import { parseGuacParams } from "@/lib/gateway/guac-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOLS = ["RDP", "SSH", "VNC"] as const;
const KINDS = ["PASSWORD", "KEY"] as const;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!vaultEnabled()) return NextResponse.json({ error: "vault_disabled" }, { status: 403 });

  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const protocol = String(b.protocol) as (typeof PROTOCOLS)[number];
  const secretKind = String(b.secretKind ?? "PASSWORD") as (typeof KINDS)[number];
  const port = Number(b.targetPort);
  const targetHost = typeof b.targetHost === "string" ? b.targetHost.trim() : "";
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const secret = typeof b.secret === "string" ? b.secret : "";
  if (!PROTOCOLS.includes(protocol) || !KINDS.includes(secretKind)) {
    return NextResponse.json({ error: "invalid_protocol" }, { status: 400 });
  }
  if (!targetHost || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !secret) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }
  await setVaultCredential({ siteId: id, protocol, targetHost, targetPort: port, username, secret, secretKind, guacParams: parseGuacParams(b.guacParams) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  await clearVaultCredential(id);
  return NextResponse.json({ ok: true });
}
