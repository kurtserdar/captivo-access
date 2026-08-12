import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { currentSessionId } from "@/lib/auth/session";
import { sessionIdsToRevoke } from "@/lib/auth/session-select";
import { recordAdminAction } from "@/lib/audit/admin";
import { clientIp } from "@/lib/request-ip";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const currentId = await currentSessionId();
  const toRevoke = sessionIdsToRevoke(ids, currentId);
  if (toRevoke.length === 0) return NextResponse.json({ ok: true, revoked: 0 });

  const res = await db.session.deleteMany({ where: { id: { in: toRevoke } } });
  await recordAdminAction({
    actor: { id: admin.id, email: admin.email },
    action: "authsession.revoke",
    targetType: "session",
    summary: `Revoked ${res.count} auth session${res.count === 1 ? "" : "s"}`,
    metadata: { revoked: res.count },
    clientIp: clientIp(req.headers) ?? null,
  });
  return NextResponse.json({ ok: true, revoked: res.count });
}
