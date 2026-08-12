import { db } from "@/lib/db";

export interface AdminAuditRow {
  id: string;
  timestamp: Date;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
}

export async function listAdminAuditEvents(filter: { limit: number; offset: number; action?: string }): Promise<{ rows: AdminAuditRow[]; total: number }> {
  const where = filter.action ? { action: filter.action } : {};
  const [rows, total] = await Promise.all([
    db.adminAuditEvent.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: { id: true, timestamp: true, actorEmail: true, action: true, targetType: true, targetId: true, summary: true },
    }),
    db.adminAuditEvent.count({ where }),
  ]);
  return { rows, total };
}
