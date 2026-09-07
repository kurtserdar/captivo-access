import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/secure-compare";
import { db } from "@/lib/db";
import { recordingEnabled } from "@/lib/recording/enabled";
import { resolvedRecordingConsentRequired, resolvedClipboardDefault } from "@/lib/settings/platform";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { withTenant } from "@/lib/tenant/scope";
import { resolveTenantByHostname } from "@/lib/tenant/resolve";

function dataplaneAuthorized(req: NextRequest): boolean {
  const s = process.env.DATAPLANE_SECRET;
  return !!s && timingSafeEqualStr(req.headers.get("x-dataplane-secret"), s);
}

export async function POST(req: NextRequest) {
  if (!dataplaneAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const host = typeof body.host === "string" ? body.host : "";
  const hostname = host.toLowerCase().trim();

  // Builds the descriptor for a resolved site. Runs inside the tenant scope in
  // cloud (so the Site lookup + policy reads are RLS-scoped to that tenant).
  const build = async (): Promise<Record<string, unknown> | null> => {
    const site = await db.site.findFirst({
      where: { hostname },
      select: { id: true, connectorId: true, upstreamUrl: true, insecureSkipVerify: true, recordSessions: true, clipboardMode: true, accessMode: true },
    });
    if (!site) return null;
    const recordSessions = site.recordSessions && recordingEnabled();
    return {
      siteId: site.id,
      connectorId: site.connectorId,
      upstreamUrl: site.upstreamUrl,
      insecureSkipVerify: site.insecureSkipVerify,
      // Runtime-gated, not just the per-Site toggle: if RECORDING_ENABLED is
      // turned off after a Site was configured to record, the dataplane must
      // stop injecting the recorder script and stripping CSP immediately.
      recordSessions,
      // Clipboard control is web-injection based (transparent only); gateway sites
      // manage clipboard in Guacamole, so never inject for them.
      clipboardMode: site.accessMode === "GATEWAY" ? "allow" : (site.clipboardMode ?? (await resolvedClipboardDefault())),
      accessMode: site.accessMode,
      // Global consent-gate policy; only meaningful when this site records.
      recordingConsentRequired: recordSessions ? await resolvedRecordingConsentRequired() : false,
    };
  };

  // Host is client-controlled and hostnames are only unique per-tenant, so in
  // cloud resolve the tenant from the hostname first, then run scoped.
  let payload: Record<string, unknown> | null = null;
  if (!hostname) {
    payload = null;
  } else if (!multiTenantEnabled()) {
    payload = await build();
  } else {
    const tenantId = await resolveTenantByHostname(hostname);
    payload = tenantId ? await withTenant(tenantId, build) : null;
  }
  if (!payload) return NextResponse.json({ error: "no_site" }, { status: 404 });
  return NextResponse.json(payload);
}
