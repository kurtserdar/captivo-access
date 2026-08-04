import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const host = typeof b.host === "string" ? b.host.trim() : "";
  const port = typeof b.port === "number" ? b.port : Number(b.port);
  const secure = b.secure === true;
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const fromName = typeof b.fromName === "string" ? b.fromName.trim() : "";
  const fromEmail = typeof b.fromEmail === "string" ? b.fromEmail.trim() : "";
  const enabled = b.enabled === true;

  if (!host || !Number.isFinite(port) || port <= 0 || !fromEmail) {
    return NextResponse.json({ error: "host_port_from_required" }, { status: 400 });
  }

  const existing = await db.smtpConfig.findUnique({ where: { id: "singleton" }, select: { password: true } });
  // Blank password on save = keep the stored one.
  const encPassword = password ? encrypt(password) : existing?.password ?? "";
  if (!encPassword) return NextResponse.json({ error: "password_required" }, { status: 400 });

  const data = { host, port, secure, username, password: encPassword, fromName, fromEmail, enabled };
  await db.smtpConfig.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
  return NextResponse.json({ ok: true });
}
