import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { genRegistrationOptions } from "@/lib/auth/webauthn";
import { setChallenge } from "@/lib/auth/challenge";
import { verifyInvite } from "@/lib/auth/invite";
import { readRecoverToken } from "@/lib/auth/recover-token";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasAnyUser } from "@/lib/auth/bootstrap";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${ip}:${new URL(req.url).pathname}`;
  if (!checkRateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = body.mode;

  if (mode === "add") {
    // Adding an extra passkey to an already logged-in user's account — returns
    // a JSON 401 instead of relying on redirect() (for the fetch() client).
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const existing = await db.passkey.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });

    const options = await genRegistrationOptions(
      { id: user.id, email: user.email, name: user.name },
      existing.map((p) => ({ credentialId: p.credentialId, transports: p.transports })),
    );
    await setChallenge(options.challenge, "reg");
    return NextResponse.json(options);
  }
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

    // uid will be used as User.id in the verify step — so the WebAuthn
    // userHandle matches the persistent User.id (see the note in the setup
    // branch).
    const uid = randomUUID();
    const options = await genRegistrationOptions({ id: uid, email: invite.email, name: invite.name }, []);
    await setChallenge(options.challenge, "reg", uid);
    return NextResponse.json(options);
  }
  if (mode !== "setup") {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }

  if (await hasAnyUser()) {
    return NextResponse.json({ error: "already_setup" }, { status: 409 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!email || !name) {
    return NextResponse.json({ error: "email_and_name_required" }, { status: 400 });
  }

  // The user doesn't exist in the DB yet (will be created in the verify step).
  // uid is generated here and used both as the WebAuthn userHandle and later
  // as User.id in verify — so the userHandle embedded in the resident
  // credential matches the persistent User.id (otherwise, when a 2nd passkey
  // is added, the platform password manager would show the same person as
  // two different accounts).
  const uid = randomUUID();
  const options = await genRegistrationOptions({ id: uid, email, name }, []);
  await setChallenge(options.challenge, "reg", uid);
  return NextResponse.json(options);
}
