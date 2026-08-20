import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/request-ip";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { verifyTotp } from "@/lib/auth/totp";
import { setRecoverToken } from "@/lib/auth/recover-token";
import { checkRateLimit } from "@/lib/rate-limit";

// To avoid leaking user enumeration: user doesn't exist / TOTP not set up /
// wrong code — all return the SAME 401 + "recover_failed". Only a fully
// valid email+TOTP combination earns a recovery cookie.
function failed(): NextResponse {
  return NextResponse.json({ error: "recover_failed" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? "unknown";
  const key = `${ip}:${new URL(req.url).pathname}`;
  if (!checkRateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const totp = typeof body.totp === "string" ? body.totp.trim() : "";
  if (!email || !totp) {
    return failed();
  }

  const user = await db.user.findUnique({ where: { email }, include: { totp: true } });
  if (!user || user.status !== "ACTIVE" || !user.totp || !user.totp.confirmedAt) {
    return failed();
  }

  let secret: string;
  try {
    secret = decrypt(user.totp.secret);
  } catch {
    return failed();
  }

  if (!verifyTotp(totp, secret)) {
    return failed();
  }

  await setRecoverToken(user.id);
  return NextResponse.json({ ok: true });
}
