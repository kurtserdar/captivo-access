import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistration } from "@/lib/auth/webauthn";
import { readChallenge, clearChallenge } from "@/lib/auth/challenge";
import { db } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { hasAnyUser } from "@/lib/auth/bootstrap";
import { verifyInvite } from "@/lib/auth/invite";
import { readRecoverToken, clearRecoverToken } from "@/lib/auth/recover-token";
import { getCurrentUser } from "@/lib/current-user";

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

  if (mode === "add") {
    const user = await getCurrentUser();
    const response = body.response as RegistrationResponseJSON | undefined;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!response || !label) {
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

    // Zaten giriş yapılmış — yeni Session OLUŞTURULMAZ, sadece Passkey eklenir.
    await db.passkey.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter ?? 0),
        transports: credential.transports ?? [],
        label,
      },
    });
    await clearChallenge();

    return NextResponse.json({ ok: true });
  }
  if (mode === "recover") {
    const userId = await readRecoverToken();
    const response = body.response as RegistrationResponseJSON | undefined;
    if (!userId || !response) {
      return NextResponse.json({ error: "recover_invalid" }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") {
      return NextResponse.json({ error: "recover_invalid" }, { status: 401 });
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

    // Mevcut kullanıcıya YENİ passkey eklenir — yeni User YARATILMAZ.
    await db.passkey.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter ?? 0),
        transports: credential.transports ?? [],
        label: "Kurtarma passkey'i",
      },
    });

    const token = await createSession(user.id, requestMeta(req));
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: sessionMaxAgeSeconds(),
    });
    await clearChallenge();
    await clearRecoverToken();

    return NextResponse.json({ ok: true });
  }
  if (mode === "invite") {
    const inviteToken = typeof body.inviteToken === "string" ? body.inviteToken : "";
    const response = body.response as RegistrationResponseJSON | undefined;
    if (!inviteToken || !response) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    // Kayıt anında tekrar doğrula: options çağrısından bu yana davet
    // kullanılmış veya süresi dolmuş olabilir.
    const invite = await verifyInvite(inviteToken);
    if (!invite) {
      return NextResponse.json({ error: "invite_invalid" }, { status: 410 });
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
      // User + Passkey + davet-tüketimi tek transaction'ında: biri başarısız
      // olursa hiçbiri commit edilmez (çift-enroll yarışını da engeller —
      // invite.updateMany({ id, usedAt: null }) koşullu güncellemesi
      // eşzamanlı iki verify'dan yalnız birinin count:1 dönmesini sağlar;
      // diğeri count:0 görüp INVITE_ALREADY_USED fırlatır ve transaction
      // rollback olur, böylece iki User da commit edilmez).
      const user = await db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: invite.email, name: invite.name, role: invite.role, status: "ACTIVE" },
        });
        await tx.passkey.create({
          data: {
            userId: created.id,
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey),
            counter: BigInt(credential.counter ?? 0),
            transports: credential.transports ?? [],
            label: "Passkey",
          },
        });
        const consumed = await tx.invite.updateMany({
          where: { id: invite.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (consumed.count === 0) {
          throw new Error("INVITE_ALREADY_USED");
        }
        return created;
      });
      userId = user.id;
    } catch (err) {
      if (err instanceof Error && err.message === "INVITE_ALREADY_USED") {
        return NextResponse.json({ error: "invite_invalid" }, { status: 410 });
      }
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }

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

  // Yarış guard: options çağrısından verify'a kadar geçen sürede biri kurulumu
  // tamamlamış olabilir. Bu kontrol ile create arasında yine küçük bir pencere
  // kalır (tam kilit için unique constraint + tek satırlık "setup lock" tablosu
  // gerekir) ama pratikte iki eşzamanlı setup'ın ikisinin de ADMIN oluşturmasını
  // engeller.
  if (await hasAnyUser()) {
    return NextResponse.json({ error: "already_setup" }, { status: 409 });
  }

  let userId: string;
  try {
    // User + Passkey oluşturma tek DB transaction'ında: biri başarısız olursa
    // diğeri de geri alınır (passkey'siz "kilitli" ADMIN kalmaz).
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email, name, role: "ADMIN", status: "ACTIVE" } });
      await tx.passkey.create({
        data: {
          userId: created.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter ?? 0),
          transports: credential.transports ?? [],
          label: "Passkey",
        },
      });
      return created;
    });
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

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
