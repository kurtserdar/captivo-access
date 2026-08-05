import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export type AuditFilter = {
  userId?: string;
  siteId?: string;
  decision?: "ALLOW" | "DENY";
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

export type AuditRow = {
  id: string;
  timestamp: Date;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  siteId: string | null;
  siteName: string | null;
  host: string;
  method: string;
  path: string;
  status: number;
  // BigInt is not JSON/CSV serializable — always exposed as a string.
  bytesOut: string;
  decision: "ALLOW" | "DENY";
  reason: string | null;
  clientIp: string | null;
  userAgent: string | null;
};

export async function listAuditEvents(filter: AuditFilter): Promise<{ rows: AuditRow[]; total: number }> {
  const where: Prisma.AuditEventWhereInput = {};

  if (filter.userId) where.userId = filter.userId;
  if (filter.siteId) where.siteId = filter.siteId;
  if (filter.decision) where.decision = filter.decision;
  if (filter.from || filter.to) {
    where.timestamp = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }

  const [events, total] = await Promise.all([
    db.auditEvent.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: filter.limit,
      skip: filter.offset,
      select: {
        id: true,
        timestamp: true,
        userId: true,
        userEmail: true,
        userName: true,
        siteId: true,
        siteName: true,
        host: true,
        method: true,
        path: true,
        status: true,
        bytesOut: true,
        decision: true,
        reason: true,
        clientIp: true,
        userAgent: true,
      },
    }),
    db.auditEvent.count({ where }),
  ]);

  const rows: AuditRow[] = events.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    userId: e.userId,
    userEmail: e.userEmail,
    userName: e.userName,
    siteId: e.siteId,
    siteName: e.siteName,
    host: e.host,
    method: e.method,
    path: e.path,
    status: e.status,
    bytesOut: String(e.bytesOut),
    decision: e.decision,
    reason: e.reason,
    clientIp: e.clientIp,
    userAgent: e.userAgent,
  }));

  return { rows, total };
}

const CSV_HEADER = [
  "timestamp",
  "userEmail",
  "siteName",
  "host",
  "method",
  "path",
  "status",
  "decision",
  "reason",
  "clientIp",
  "bytesOut",
];

function csvEscape(value: string): string {
  // Formula-injection guard: fields like userAgent/path can carry
  // attacker-influenced content. If the value starts with a character a
  // spreadsheet (Excel/Sheets) interprets as a formula prefix (= + - @) or
  // a tab/CR, prepend a single quote so it opens as plain text instead of
  // being evaluated as a formula.
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(value);
  const escaped = needsFormulaGuard ? `'${value}` : value;
  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

export function toCsv(rows: AuditRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    const fields = [
      row.timestamp.toISOString(),
      row.userEmail ?? "",
      row.siteName ?? "",
      row.host,
      row.method,
      row.path,
      String(row.status),
      row.decision,
      row.reason ?? "",
      row.clientIp ?? "",
      row.bytesOut,
    ];
    lines.push(fields.map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}
