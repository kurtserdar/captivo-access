import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { setSessionControl } from "@/lib/dataplane/client";
import { appendAuditEvents } from "@/lib/audit/append";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { sessionId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "release" ? "release" : "take";

  const result = await setSessionControl(sessionId, admin.id, action);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason ?? "failed" }, { status: 409 });

  try {
    await appendAuditEvents([
      {
        userId: admin.id,
        host: "manager",
        method: "POST",
        path: `/live/${sessionId}`,
        status: 200,
        decision: "ALLOW",
        reason: action === "take" ? "Admin took control of a live session" : "Admin released control of a live session",
      },
    ]);
  } catch (err) {
    console.error("[live/control] audit append failed:", err);
  }
  return NextResponse.json({ ok: true });
}
