import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { listSitesForRequest } from "@/lib/access/grants";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sites = await listSitesForRequest(user.id);
  return NextResponse.json({ sites });
}
