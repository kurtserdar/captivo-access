import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { terminateSession } from "@/lib/dataplane/client";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireUser();
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const result = await terminateSession(id);
  return NextResponse.json(result);
}
