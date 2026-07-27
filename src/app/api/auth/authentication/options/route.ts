import { NextRequest, NextResponse } from "next/server";
import { genAuthenticationOptions } from "@/lib/auth/webauthn";
import { setChallenge } from "@/lib/auth/challenge";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${ip}:${new URL(req.url).pathname}`;
  if (!checkRateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const options = await genAuthenticationOptions();
  await setChallenge(options.challenge, "auth");
  return NextResponse.json(options);
}
