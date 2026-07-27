import { NextRequest, NextResponse } from "next/server";
import { redeemPairing } from "@/lib/connector/enrollment";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`${ip}:/api/connector/enroll`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const pairCode = typeof body.pairCode === "string" ? body.pairCode : "";
  if (!pairCode) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const result = await redeemPairing(pairCode, {
    name: typeof body.name === "string" ? body.name : undefined,
    version: typeof body.version === "string" ? body.version : undefined,
  });
  if (!result) return NextResponse.json({ error: "invalid_pairing" }, { status: 401 });
  return NextResponse.json(result);
}
