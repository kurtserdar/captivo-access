import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { evaluateAccess } from "@/lib/access/evaluate";
import { dataplaneFilesUrl, dataplaneSecretHeader } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const siteId = url.searchParams.get("site") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!siteId || !name) return NextResponse.json({ error: "site_and_name_required" }, { status: 400 });
  const decision = await evaluateAccess(user.id, siteId, new Date());
  if (!decision.allow) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const qs = `op=download&userId=${encodeURIComponent(user.id)}&siteId=${encodeURIComponent(siteId)}&name=${encodeURIComponent(name)}`;
  const res = await fetch(dataplaneFilesUrl(qs), { headers: dataplaneSecretHeader(), cache: "no-store" });
  if (!res.ok || !res.body) return NextResponse.json({ error: "unavailable" }, { status: res.status || 502 });
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": res.headers.get("content-disposition") ?? `attachment; filename="${name}"`,
    },
  });
}
