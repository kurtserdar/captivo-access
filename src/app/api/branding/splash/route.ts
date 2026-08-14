import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the custom splash image to any authenticated user (branding, not sensitive).
// no-store so a re-upload shows immediately. Sandboxing CSP + nosniff neutralise any
// mistyped payload.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await db.brandingConfig.findUnique({ where: { id: "singleton" }, select: { splashImage: true, splashImageType: true } });
  if (!b?.splashImage || !b.splashImageType) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(b.splashImage), {
    status: 200,
    headers: {
      "Content-Type": b.splashImageType,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
