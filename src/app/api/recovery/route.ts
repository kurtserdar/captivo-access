import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { verifyTotp } from "@/lib/auth/totp";
import { encrypt } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (!code || !secret) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!verifyTotp(code, secret)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  await db.totpSecret.upsert({
    where: { userId: user.id },
    create: { userId: user.id, secret: encrypt(secret), confirmedAt: new Date() },
    update: { secret: encrypt(secret), confirmedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await db.totpSecret.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
