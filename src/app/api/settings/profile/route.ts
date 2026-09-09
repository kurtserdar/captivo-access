import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { withTenantRoute } from "@/lib/tenant/request";
import { normalizeDisplayName } from "@/lib/auth/display-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Self-service display name. Directory-managed users are synced from the IdP,
// so their name is owned by the directory, not editable here.
export const POST = withTenantRoute(async (req: Request) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = normalizeDisplayName(body.name);
  if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  const current = await db.user.findUnique({ where: { id: user.id }, select: { directoryManaged: true } });
  if (current?.directoryManaged) return NextResponse.json({ error: "directory_managed" }, { status: 409 });
  await db.user.update({ where: { id: user.id }, data: { name } });
  return NextResponse.json({ ok: true, name });
});
