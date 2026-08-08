import type { Prisma } from "@/generated/prisma/client";

export interface RecordingFilter {
  q?: string;
  userId?: string;
  siteId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

// Pure + db-free so the list route and its tests share one definition.
export function buildRecordingWhere(filter: RecordingFilter): Prisma.SessionRecordingWhereInput {
  const where: Prisma.SessionRecordingWhereInput = {};
  if (filter.userId) where.userId = filter.userId;
  if (filter.siteId) where.siteId = filter.siteId;
  if (filter.from || filter.to) {
    where.startedAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  const q = filter.q?.trim();
  if (q && q.length >= 2) {
    where.host = { contains: q, mode: "insensitive" };
  }
  return where;
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseRecordingFilter(
  sp: URLSearchParams,
  opts: { defaultLimit: number; maxLimit: number },
): RecordingFilter {
  const q = sp.get("q")?.trim() || undefined;
  const userId = sp.get("userId")?.trim() || undefined;
  const siteId = sp.get("siteId")?.trim() || undefined;
  const from = parseDate(sp.get("from"));
  const to = parseDate(sp.get("to"));
  const limitParam = Number(sp.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), opts.maxLimit) : opts.defaultLimit;
  const offsetParam = Number(sp.get("offset"));
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? Math.floor(offsetParam) : 0;
  return { q, userId, siteId, from, to, limit, offset };
}
