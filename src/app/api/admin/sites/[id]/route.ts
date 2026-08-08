import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const hostname = typeof body.hostname === "string" ? body.hostname.trim().toLowerCase() : "";
  const upstreamUrl = typeof body.upstreamUrl === "string" ? body.upstreamUrl.trim() : "";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const insecureSkipVerify = body.insecureSkipVerify === true;
  const recordSessions = recordingEnabled() && body.recordSessions === true;
  const accessMode = body.accessMode === "GATEWAY" ? "GATEWAY" : "TRANSPARENT";

  if (!connectorId || !name || !upstreamUrl) return NextResponse.json({ error: "connector_name_upstream_required" }, { status: 400 });
  if (!hostname) return NextResponse.json({ error: "invalid_hostname" }, { status: 400 });
  let u: URL;
  try { u = new URL(upstreamUrl); } catch { return NextResponse.json({ error: "invalid_upstream_url" }, { status: 400 }); }
  if (u.protocol !== "http:" && u.protocol !== "https:") return NextResponse.json({ error: "invalid_upstream_url" }, { status: 400 });

  const connector = await db.connector.findUnique({ where: { id: connectorId }, select: { id: true } });
  if (!connector) return NextResponse.json({ error: "connector_not_found" }, { status: 400 });

  const existing = await db.site.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    await db.site.update({ where: { id }, data: { connectorId, name, hostname, upstreamUrl, description, insecureSkipVerify, recordSessions, accessMode } });
  } catch (e) {
    // P2002 = the hostname unique constraint is taken by a different site.
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "hostname_taken" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const existing = await db.site.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await db.site.delete({ where: { id } }); // cascades the Site's AccessGrant rows
  return NextResponse.json({ ok: true });
}
