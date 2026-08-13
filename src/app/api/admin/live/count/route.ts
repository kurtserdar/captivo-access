import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listActiveSessions } from "@/lib/dataplane/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sessions = await listActiveSessions();
  return NextResponse.json({ count: sessions.length });
}
