import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { decideGrant } from "@/lib/access/grants";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = body.decision;
  if (decision !== "approve" && decision !== "deny") {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }

  const count = await decideGrant(id, decision, admin.id);
  if (count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
