import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listActiveSessions, listActiveWebSessions } from "@/lib/dataplane/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "read_console")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // Count both gateway and web-app sessions, matching the console LIVE KPI.
  const [gateway, web] = await Promise.all([listActiveSessions(), listActiveWebSessions()]);
  return NextResponse.json({ count: gateway.length + web.length });
}
