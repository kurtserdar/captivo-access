import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { genRegistrationOptions } from "@/lib/auth/webauthn";
import { setChallenge } from "@/lib/auth/challenge";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = body.mode;

  if (mode === "invite") {
    // TODO Task 6: davetten kayıt (inviteToken doğrulama → email/name davetten okunur)
    return NextResponse.json({ error: "not_implemented" }, { status: 501 });
  }
  if (mode !== "setup") {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!email || !name) {
    return NextResponse.json({ error: "email_and_name_required" }, { status: 400 });
  }

  // Kullanıcı henüz DB'de yok (verify aşamasında oluşturulacak) — WebAuthn
  // userHandle için geçici bir kimlik yeterli, kalıcı değil.
  const options = await genRegistrationOptions({ id: randomUUID(), email, name }, []);
  await setChallenge(options.challenge, "reg");
  return NextResponse.json(options);
}
