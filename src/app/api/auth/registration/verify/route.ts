import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistration } from "@/lib/auth/webauthn";
import { readChallenge, clearChallenge } from "@/lib/auth/challenge";
import { db } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";

function sessionMaxAgeSeconds(): number {
  const h = Number(process.env.SESSION_TTL_HOURS ?? "12");
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3600;
}

function requestMeta(req: NextRequest) {
  return {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = body.mode;

  if (mode === "invite") {
    // TODO Task 6: davetten kayıt — verifyInvite(inviteToken) + User oluştur + consumeInvite
    return NextResponse.json({ error: "not_implemented" }, { status: 501 });
  }
  if (mode !== "setup") {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const response = body.response as RegistrationResponseJSON | undefined;
  if (!email || !name || !response) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const expectedChallenge = await readChallenge("reg");
  if (!expectedChallenge) {
    return NextResponse.json({ error: "challenge_expired" }, { status: 401 });
  }

  const result = await verifyRegistration(response, expectedChallenge, req.nextUrl.origin);
  if (!result.verified || !result.registrationInfo) {
    return NextResponse.json({ error: "verification_failed" }, { status: 401 });
  }
  const { credential } = result.registrationInfo;

  let userId: string;
  try {
    const user = await db.user.create({ data: { email, name, role: "ADMIN", status: "ACTIVE" } });
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  await db.passkey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter ?? 0),
      transports: credential.transports ?? [],
      label: "Passkey",
    },
  });

  const token = await createSession(userId, requestMeta(req));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeSeconds(),
  });
  await clearChallenge();

  return NextResponse.json({ ok: true });
}
