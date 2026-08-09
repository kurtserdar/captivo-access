import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { listGroupMappings, createGroupMapping } from "@/lib/directory/mappings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  const admin = await getCurrentUser();
  if (!admin) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!can(admin.role, "configure")) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { admin };
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  return NextResponse.json({ mappings: await listGroupMappings() });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.groupDN !== "string" || (body.kind !== "ROLE" && body.kind !== "SITE")) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const result = await createGroupMapping({
    groupDN: body.groupDN,
    kind: body.kind,
    role: body.kind === "ROLE" ? body.role ?? null : null,
    siteId: body.kind === "SITE" ? body.siteId ?? null : null,
    enabled: body.enabled !== false,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
