import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getWatchStatus } from "@/lib/dataplane/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const user = await requireUser();
  const { siteId } = await params;
  const status = await getWatchStatus(user.id, siteId);
  return NextResponse.json(status);
}
