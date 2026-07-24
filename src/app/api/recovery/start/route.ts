import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { generateTotpSecret, totpKeyUri } from "@/lib/auth/totp";

// Sır burada henüz KAYDEDİLMEZ — yalnızca /api/recovery POST ile kod
// doğrulandıktan sonra şifrelenip saklanır (onaysız sır DB'de kalmaz).
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = generateTotpSecret();
  const otpauth = totpKeyUri(secret, user.email, "Captivo Access");
  return NextResponse.json({ secret, otpauth });
}
