import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getCurrentUser } from "@/lib/current-user";
import { generateTotpSecret, totpKeyUri } from "@/lib/auth/totp";

export const runtime = "nodejs";

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
  // QR of the otpauth URI so the authenticator app can be enrolled by scanning;
  // rendered server-side (PNG data URL) so the client bundle stays free of it.
  let qr: string | null = null;
  try {
    qr = await QRCode.toDataURL(otpauth, { errorCorrectionLevel: "M", margin: 1, width: 220 });
  } catch {
    qr = null; // manual entry still works
  }
  return NextResponse.json({ secret, otpauth, qr });
}
