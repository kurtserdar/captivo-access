import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { getOidcConfig } from "@/lib/auth/oidc-config";
import { discover } from "@/lib/auth/oidc";
import { db } from "@/lib/db";
import { verifyResultFields } from "@/lib/admin/verify-result";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const cfg = await getOidcConfig();
  if (!cfg || !cfg.issuer) return NextResponse.json({ ok: false, error: "no_issuer" });

  const now = new Date();
  try {
    const d = await discover(cfg.issuer);
    await db.oidcConfig.updateMany({ where: { id: "singleton" }, data: verifyResultFields(true, null, now) });
    return NextResponse.json({ ok: true, authorization_endpoint: d.authorization_endpoint, token_endpoint: d.token_endpoint });
  } catch {
    await db.oidcConfig.updateMany({ where: { id: "singleton" }, data: verifyResultFields(false, "unreachable", now) });
    return NextResponse.json({ ok: false, error: "unreachable" });
  }
}
