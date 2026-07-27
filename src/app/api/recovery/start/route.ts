import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { generateTotpSecret, totpKeyUri } from "@/lib/auth/totp";

// The secret is NOT SAVED here yet — it's only encrypted and stored after
// the code is verified via /api/recovery POST (an unconfirmed secret never
// lands in the DB).
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = generateTotpSecret();
  const otpauth = totpKeyUri(secret, user.email, "Captivo Access");
  return NextResponse.json({ secret, otpauth });
}
