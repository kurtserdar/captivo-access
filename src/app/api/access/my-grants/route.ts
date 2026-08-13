import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { listUserGrants } from "@/lib/access/grants";
import { classifyGrant } from "@/lib/access/evaluate";

export const dynamic = "force-dynamic";

// The signed-in user's currently-active grants, for the login "access-ready" step.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const grants = (await listUserGrants(user.id))
    .filter((g) => classifyGrant(g, now) === "allow")
    .map((g) => ({
      id: g.id,
      siteName: g.site.name,
      accessMode: g.site.accessMode as "TRANSPARENT" | "GATEWAY" | "ISOLATED",
      endsAt: g.endsAt ? g.endsAt.toISOString() : null,
      scheduled: g.schedule != null,
    }));

  return NextResponse.json({ grants });
}
