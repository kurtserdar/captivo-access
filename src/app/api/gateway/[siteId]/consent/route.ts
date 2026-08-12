import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { appendAuditEvents } from "@/lib/audit/append";
import { clientIp } from "@/lib/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true } });
  if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    await appendAuditEvents([
      {
        userId: user.id,
        siteId,
        host: "manager",
        method: "POST",
        path: `/gateway/${siteId}/session`,
        status: 200,
        decision: "ALLOW",
        reason: "Vendor acknowledged that this session is recorded",
        clientIp: clientIp(req.headers),
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
    ]);
  } catch (err) {
    console.error("[gateway/consent] audit append failed:", err);
  }

  // Remember the acknowledgement like web sessions do: a session-scoped (no expiry
  // → cleared on browser close → fresh consent each browser session), per-site,
  // HttpOnly cookie that the session page reads to skip re-prompting.
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: `ca_rec_consent_${siteId}`,
    value: "1",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });
  return res;
}
