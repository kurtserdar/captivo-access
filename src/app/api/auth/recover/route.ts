import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { verifyTotp } from "@/lib/auth/totp";
import { setRecoverToken } from "@/lib/auth/recover-token";

// Kullanıcı numaralandırmasını sızdırmamak için: kullanıcı yok / TOTP kurulu
// değil / kod yanlış — hepsi AYNI 401 + "recover_failed" döner. Yalnızca
// tam geçerli e-posta+TOTP kombinasyonu kurtarma cookie'si kazanır.
function failed(): NextResponse {
  return NextResponse.json({ error: "recover_failed" }, { status: 401 });
}

export async function POST(req: NextRequest) {
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
