import { NextResponse } from "next/server";
import { recordingEnabled } from "@/lib/recording/enabled";
import { RECORDER_JS } from "@/recorder/rec.bundle";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  if (req.headers.get("x-dataplane-secret") !== process.env.DATAPLANE_SECRET) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!recordingEnabled()) return new NextResponse("", { status: 404 });
  return new NextResponse(RECORDER_JS, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8" } });
}
