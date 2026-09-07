import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { getSessionUser } from "@/lib/auth/session";
import { sha256 } from "@/lib/auth/tokens";
import { requireDataplaneSecret, resolveTenantBySessionToken, withTenantFrom } from "@/lib/tenant/internal";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

// Same hash as getSessionUser/createSession (Session.tokenHash = sha256(token)),
// so this resolves the tenant that owns the Session row without a second read.
async function tenantFromReq(req: NextRequest): Promise<string | null> {
  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  return token ? resolveTenantBySessionToken(sha256(token)) : null;
}

async function handler(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  const user = token ? await getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: "no_session" }, { status: 401 });
  return NextResponse.json({ userId: user.id, email: user.email });
}

export const POST = requireDataplaneSecret(withTenantFrom(tenantFromReq)(handler));
