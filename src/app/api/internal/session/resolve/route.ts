import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && req.headers.get("x-dataplane-secret") === s;
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  const user = token ? await getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: "no_session" }, { status: 401 });
  return NextResponse.json({ userId: user.id, email: user.email });
}
