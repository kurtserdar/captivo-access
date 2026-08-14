import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireUser();
  const body = (await req.json().catch(() => ({}))) as { timezone?: string };
  const tz = typeof body.timezone === "string" && body.timezone ? body.timezone : null;
  // Validate against the IANA set (Intl throws on an unknown zone).
  if (tz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      return NextResponse.json({ error: "invalid_timezone" }, { status: 400 });
    }
  }
  await db.user.update({ where: { id: user.id }, data: { timezone: tz } });
  return NextResponse.json({ ok: true });
}
