import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listAuditEvents, toCsv } from "@/lib/audit/query";
import { parseAuditFilter } from "@/lib/audit/filter";

const EXPORT_LIMIT = 10000;

export async function GET(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "read_console")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const filter = parseAuditFilter(req.nextUrl.searchParams, { defaultLimit: EXPORT_LIMIT, maxLimit: EXPORT_LIMIT });
  const { rows } = await listAuditEvents(filter);
  const csv = toCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit.csv"',
    },
  });
}
