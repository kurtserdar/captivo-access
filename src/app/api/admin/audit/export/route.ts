import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listAuditEvents, toCsv, type AuditFilter } from "@/lib/audit/query";

const EXPORT_LIMIT = 10000;

function parseFilter(searchParams: URLSearchParams): AuditFilter {
  const userId = searchParams.get("userId")?.trim() || undefined;
  const siteId = searchParams.get("siteId")?.trim() || undefined;

  const decisionParam = searchParams.get("decision");
  const decision = decisionParam === "ALLOW" || decisionParam === "DENY" ? decisionParam : undefined;

  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));

  return { userId, siteId, decision, from, to, limit: EXPORT_LIMIT, offset: 0 };
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!can(admin.role, "read_console")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const filter = parseFilter(req.nextUrl.searchParams);
  const { rows } = await listAuditEvents(filter);
  const csv = toCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit.csv"',
    },
  });
}
