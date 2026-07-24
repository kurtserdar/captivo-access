import { NextResponse } from "next/server";
import { genAuthenticationOptions } from "@/lib/auth/webauthn";
import { setChallenge } from "@/lib/auth/challenge";

export async function POST() {
  const options = await genAuthenticationOptions();
  await setChallenge(options.challenge, "auth");
  return NextResponse.json(options);
}
