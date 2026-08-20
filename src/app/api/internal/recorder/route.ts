import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { recordingEnabled } from "@/lib/recording/enabled";
import { RECORDER_JS } from "@/recorder/rec.bundle";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const secret = process.env.DATAPLANE_SECRET;
  if (!timingSafeEqualStr(req.headers.get("x-dataplane-secret"), secret)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!recordingEnabled()) return new NextResponse("", { status: 404 });
  return new NextResponse(RECORDER_JS, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8" } });
}
