import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { recordingEnabled } from "@/lib/recording/enabled";
import { resolvedRecordingConsentRequired } from "@/lib/settings/platform";
import { GatewaySession } from "./session-client";
import { ConsentGate } from "./consent-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

// Top-level route (outside the (app) shell) so the session is the ONLY thing on
// screen — no header, no sidebar, full viewport.
export default async function GatewaySessionPage({ params }: { params: Promise<{ siteId: string }> }) {
  await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true, recordSessions: true } });
  // Native is the only gateway now — a non-native / disabled / non-gateway site
  // has no session here.
  if (!nativeGatewayEnabled() || !site || site.accessMode !== "GATEWAY") {
    notFound();
  }
  const recorded = recordingEnabled() && site.recordSessions;
  // Ask for recording consent once per browser session (matches web sessions):
  // skip the gate if the vendor already acknowledged this resource this session.
  const alreadyConsented = (await cookies()).get(`ca_rec_consent_${siteId}`)?.value === "1";
  const consentNeeded = site.recordSessions && !alreadyConsented && (await resolvedRecordingConsentRequired());
  return consentNeeded ? <ConsentGate siteId={siteId} recorded={recorded} /> : <GatewaySession siteId={siteId} recorded={recorded} />;
}
