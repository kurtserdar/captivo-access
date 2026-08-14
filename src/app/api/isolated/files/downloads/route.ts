import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listIsolatedDownloads } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser();
  const siteId = new URL(req.url).searchParams.get("site") ?? "";
  if (!siteId) return NextResponse.json({ error: "site_required" }, { status: 400 });
  return NextResponse.json(await listIsolatedDownloads(user.id, siteId));
}
