import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves a Site's uploaded logo to any authenticated user (a Site logo is
// branding, not sensitive). The sandboxing CSP + nosniff neutralise any
// malicious SVG even if the URL is opened directly.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const site = await db.site.findUnique({ where: { id }, select: { logo: true, logoType: true } });
  if (!site?.logo || !site.logoType) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Buffer.from(site.logo), {
    status: 200,
    headers: {
      "Content-Type": site.logoType,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
