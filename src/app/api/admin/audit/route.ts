import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listAuditEvents, type AuditFilter } from "@/lib/audit/query";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function parseFilter(searchParams: URLSearchParams): AuditFilter {
  const userId = searchParams.get("userId")?.trim() || undefined;
  const siteId = searchParams.get("siteId")?.trim() || undefined;

  const decisionParam = searchParams.get("decision");
  const decision = decisionParam === "ALLOW" || decisionParam === "DENY" ? decisionParam : undefined;

  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));

  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), MAX_LIMIT) : DEFAULT_LIMIT;

  const offsetParam = Number(searchParams.get("offset"));
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? Math.floor(offsetParam) : 0;

  return { userId, siteId, decision, from, to, limit, offset };
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
  const { rows, total } = await listAuditEvents(filter);

  return NextResponse.json({ rows, total });
}
