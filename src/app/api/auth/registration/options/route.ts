import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { genRegistrationOptions } from "@/lib/auth/webauthn";
import { setChallenge } from "@/lib/auth/challenge";
import { verifyInvite } from "@/lib/auth/invite";
import { readRecoverToken } from "@/lib/auth/recover-token";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = body.mode;

  if (mode === "recover") {
    const userId = await readRecoverToken();
    const user = userId ? await db.user.findUnique({ where: { id: userId }, include: { passkeys: true } }) : null;
    if (!user || user.status !== "ACTIVE") {
      return NextResponse.json({ error: "recover_invalid" }, { status: 401 });
    }

    const options = await genRegistrationOptions(
      { id: user.id, email: user.email, name: user.name },
      user.passkeys.map((p) => ({ credentialId: p.credentialId, transports: p.transports })),
    );
    await setChallenge(options.challenge, "reg");
    return NextResponse.json(options);
  }
  if (mode === "invite") {
    const inviteToken = typeof body.inviteToken === "string" ? body.inviteToken : "";
    const invite = inviteToken ? await verifyInvite(inviteToken) : null;
    if (!invite) {
      return NextResponse.json({ error: "invite_invalid" }, { status: 410 });
    }

    const options = await genRegistrationOptions({ id: randomUUID(), email: invite.email, name: invite.name }, []);
    await setChallenge(options.challenge, "reg");
    return NextResponse.json(options);
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
