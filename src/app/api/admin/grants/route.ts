import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { createGrant, listGrants, revokeGrant } from "@/lib/access/grants";
import { validateSchedule, type Schedule } from "@/lib/access/schedule";

function parseDate(value: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d };
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const siteId = typeof body.siteId === "string" ? body.siteId.trim() : "";
  if (!userId || !siteId) {
    return NextResponse.json({ error: "user_site_required" }, { status: 400 });
  }

  const startsAt = parseDate(body.startsAt);
  const endsAt = parseDate(body.endsAt);
  if (!startsAt.ok || !endsAt.ok) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  let schedule: Schedule | null = null;
  if (body.schedule !== undefined && body.schedule !== null) {
    const v = validateSchedule(body.schedule);
    if (!v.ok) return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    schedule = v.schedule;
  }

  const [user, site] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true } }),
    db.site.findUnique({ where: { id: siteId }, select: { id: true } }),
  ]);
  if (!user) {
    return NextResponse.json({ error: "invalid_user" }, { status: 400 });
  }
  if (!site) {
    return NextResponse.json({ error: "invalid_site" }, { status: 400 });
  }

  const { id } = await createGrant({
    userId,
    siteId,
    startsAt: startsAt.value,
    endsAt: endsAt.value,
    note,
    createdById: admin.id,
    schedule,
  });

  return NextResponse.json({ id }, { status: 201 });
}

export async function GET() {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const grants = await listGrants();
  return NextResponse.json({ grants });
}

export async function DELETE(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (admin.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  await revokeGrant(id);
  return NextResponse.json({ ok: true });
}
