import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { dataplaneFilesUrl, dataplaneSecretHeader } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = Number(process.env.ISOLATED_FT_MAX_BYTES ?? 100 * 1024 * 1024);

export async function POST(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const siteId = url.searchParams.get("site") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!siteId || !name) return NextResponse.json({ error: "site_and_name_required" }, { status: 400 });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (!len || Number.isNaN(len)) return NextResponse.json({ error: "length_required" }, { status: 411 });
  if (len > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const body = await req.arrayBuffer(); // bounded by the MAX_BYTES check above
  const qs = `op=upload&userId=${encodeURIComponent(user.id)}&siteId=${encodeURIComponent(siteId)}&name=${encodeURIComponent(name)}`;
  const res = await fetch(dataplaneFilesUrl(qs), {
    method: "POST",
    headers: { ...dataplaneSecretHeader(), "content-type": "application/octet-stream", "content-length": String(body.byteLength) },
    body,
  });
  return NextResponse.json(res.ok ? { ok: true } : { ok: false }, { status: res.status });
}
