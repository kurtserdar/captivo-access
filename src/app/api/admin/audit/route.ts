import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listAuditEvents } from "@/lib/audit/query";
import { parseAuditFilter } from "@/lib/audit/filter";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "read_console")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const filter = parseAuditFilter(req.nextUrl.searchParams, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT });
  const { rows, total } = await listAuditEvents(filter);

  return NextResponse.json({ rows, total });
}
