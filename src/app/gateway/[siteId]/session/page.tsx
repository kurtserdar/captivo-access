import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { GatewaySession } from "./session-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

// Top-level route (outside the (app) shell) so the session is the ONLY thing on
// screen — no header, no sidebar, full viewport.
export default async function GatewaySessionPage({ params }: { params: Promise<{ siteId: string }> }) {
  await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true } });
  if (!nativeGatewayEnabled() || !site || site.accessMode !== "GATEWAY") {
    redirect(`/api/access/gateway/${siteId}/launch`);
  }
  return <GatewaySession siteId={siteId} />;
}
