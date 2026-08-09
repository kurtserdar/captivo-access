import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { updateGroupMapping, deleteGroupMapping } from "@/lib/directory/mappings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  await updateGroupMapping(id, {
    groupDN: typeof body.groupDN === "string" ? body.groupDN : undefined,
    role: body.role !== undefined ? body.role : undefined,
    siteId: body.siteId !== undefined ? body.siteId : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  await deleteGroupMapping(id);
  return NextResponse.json({ ok: true });
}
