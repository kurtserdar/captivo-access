import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { terminateSession } from "@/lib/dataplane/client";

export async function POST(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { sessionId } = await ctx.params;
  const result = await terminateSession(sessionId);
  return NextResponse.json(result);
}
