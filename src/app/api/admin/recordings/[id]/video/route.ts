import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(admin.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const rec = await db.sessionRecording.findUnique({ where: { id } });
  if (!rec || rec.format !== "VIDEO") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const chunks = await db.recordingChunk.findMany({
    where: { recordingId: id },
    orderBy: { seq: "asc" },
    select: { data: true },
  });
  const blob = Buffer.concat(chunks.map((c) => Buffer.from(c.data)));
  const total = blob.length;

  // Honour Range so the browser can scrub the seekable WebM instead of loading it all.
  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" } });
    }
    const slice = blob.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        "Content-Type": "video/webm",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(slice.length),
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(new Uint8Array(blob), {
    status: 200,
    headers: {
      "Content-Type": "video/webm",
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
