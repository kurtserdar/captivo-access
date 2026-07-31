import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { createAccessRequest } from "@/lib/access/grants";
import { validateSchedule, type Schedule } from "@/lib/access/schedule";

function parseDate(value: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const siteId = typeof body.siteId === "string" ? body.siteId.trim() : "";
  if (!siteId) return NextResponse.json({ error: "site_required" }, { status: 400 });

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return NextResponse.json({ error: "note_required" }, { status: 400 });

  const startsAt = parseDate(body.startsAt);
  const endsAt = parseDate(body.endsAt);
  if (!startsAt.ok || !endsAt.ok) return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  if (startsAt.value && endsAt.value && startsAt.value > endsAt.value) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  let schedule: Schedule | null = null;
  if (body.schedule !== undefined && body.schedule !== null) {
    const v = validateSchedule(body.schedule);
    if (!v.ok) return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    schedule = v.schedule;
  }

  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true } });
  if (!site) return NextResponse.json({ error: "invalid_site" }, { status: 400 });

  const result = await createAccessRequest({
    userId: user.id,
    siteId,
    startsAt: startsAt.value,
    endsAt: endsAt.value,
    note,
    schedule,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json({ id: result.id }, { status: 201 });
}
