import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { GatewaySession } from "./session-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

export default async function GatewaySessionPage({ params }: { params: Promise<{ siteId: string }> }) {
  await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true } });
  // When native gateway is off or the site isn't a gateway, fall back to the
  // json-auth launch (the previous behaviour) — never a dead page.
  if (!nativeGatewayEnabled() || !site || site.accessMode !== "GATEWAY") {
    redirect(`/api/access/gateway/${siteId}/launch`);
  }
  return <GatewaySession siteId={siteId} />;
}
