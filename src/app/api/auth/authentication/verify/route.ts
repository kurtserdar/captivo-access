import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthentication } from "@/lib/auth/webauthn";
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
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!response?.id) {
    return NextResponse.json({ error: "invalid_body" }, { status: 401 });
  }

  const expectedChallenge = await readChallenge("auth");
  if (!expectedChallenge) {
    return NextResponse.json({ error: "challenge_expired" }, { status: 401 });
  }

  const passkey = await db.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
  if (!passkey || passkey.user.status !== "ACTIVE") {
    return NextResponse.json({ error: "verification_failed" }, { status: 401 });
  }

  let result;
  try {
    result = await verifyAuthentication(response, expectedChallenge, req.nextUrl.origin, {
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: Number(passkey.counter),
      transports: passkey.transports,
    });
  } catch {
    return NextResponse.json({ error: "verification_failed" }, { status: 401 });
  }
  if (!result.verified) {
    return NextResponse.json({ error: "verification_failed" }, { status: 401 });
  }

  await db.passkey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });

  const token = await createSession(passkey.userId, requestMeta(req));
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
