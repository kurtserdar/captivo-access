import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { isolationEnabled } from "@/lib/isolation/enabled";
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
  const site = await db.site.findUnique({ where: { id: siteId }, select: { accessMode: true, recordSessions: true, clipboardMode: true, isolationHiFi: true } });
  // This full-screen session page serves native GATEWAY (RDP/SSH/VNC) and ISOLATED
  // (remote browser) resources — both stream a screen via guacd. Everything else
  // (or a disabled capability) has no session here.
  const okGateway = nativeGatewayEnabled() && site?.accessMode === "GATEWAY";
  const okIsolated = isolationEnabled() && site?.accessMode === "ISOLATED";
  if (!site || (!okGateway && !okIsolated)) {
    notFound();
  }
  // High-fidelity ISOLATED streams via KasmVNC — the data-plane reverse-proxies its
  // web client + WS at /kasm-tunnel/. Render it full-viewport instead of the guac client.
  if (site.accessMode === "ISOLATED" && site.isolationHiFi) {
    return <iframe title="Isolated browser" src="/kasm-tunnel/" style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }} allow="clipboard-read; clipboard-write" />;
  }
  const recorded = recordingEnabled() && site.recordSessions;
  // Ask for recording consent once per browser session (matches web sessions):
  // skip the gate if the vendor already acknowledged this resource this session.
  const alreadyConsented = (await cookies()).get(`ca_rec_consent_${siteId}`)?.value === "1";
  const consentNeeded = site.recordSessions && !alreadyConsented && (await resolvedRecordingConsentRequired());
  return consentNeeded
    ? <ConsentGate siteId={siteId} recorded={recorded} clipboardMode={site.clipboardMode} />
    : <GatewaySession siteId={siteId} recorded={recorded} clipboardMode={site.clipboardMode} />;
}
