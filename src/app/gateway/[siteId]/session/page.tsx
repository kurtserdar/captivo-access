import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { isolationEnabled } from "@/lib/isolation/enabled";
import { recordingEnabled } from "@/lib/recording/enabled";
import { resolvedRecordingConsentRequired } from "@/lib/settings/platform";
import { GatewaySession } from "./session-client";
import { IsolatedSession } from "./isolated-client";
import { ConsentGate } from "./consent-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

// Top-level route (outside the (app) shell) so the session is the ONLY thing on
// screen — no header, no sidebar, full viewport.
export default async function GatewaySessionPage({ params }: { params: Promise<{ siteId: string }> }) {
  await requireUser();
  const { siteId } = await params;
  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true, name: true, recordSessions: true, clipboardMode: true, fileTransferMode: true } });
  // This full-screen session page serves native GATEWAY (RDP/SSH/VNC) and ISOLATED
  // (remote browser) resources — both stream a screen via guacd. Everything else
  // (or a disabled capability) has no session here.
  const okGateway = nativeGatewayEnabled() && site?.accessMode === "GATEWAY";
  const okIsolated = isolationEnabled() && site?.accessMode === "ISOLATED";
  if (!site || (!okGateway && !okIsolated)) {
    notFound();
  }
  const recorded = recordingEnabled() && site.recordSessions;
  // Ask for recording consent once per browser session (matches web sessions):
  // skip the gate if the vendor already acknowledged this resource this session.
  const alreadyConsented = (await cookies()).get(`ca_rec_consent_${siteId}`)?.value === "1";
  const consentNeeded = site.recordSessions && !alreadyConsented && (await resolvedRecordingConsentRequired());
  // Past the okGateway/okIsolated guards, accessMode is GATEWAY or ISOLATED; narrow
  // the Prisma enum (which also has TRANSPARENT) to the union the viewers expect.
  const mode = site.accessMode === "ISOLATED" ? "ISOLATED" : "GATEWAY";
  if (consentNeeded) {
    return <ConsentGate accessMode={mode} siteId={siteId} siteName={site.name} recorded={recorded} clipboardMode={site.clipboardMode} fileTransferMode={site.fileTransferMode} />;
  }
  return mode === "ISOLATED"
    ? <IsolatedSession siteId={siteId} siteName={site.name} recorded={recorded} fileTransferMode={site.fileTransferMode} />
    : <GatewaySession siteId={siteId} siteName={site.name} recorded={recorded} clipboardMode={site.clipboardMode} />;
}
