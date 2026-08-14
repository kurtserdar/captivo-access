import { parseGuacParams, type GuacParams } from "@/lib/gateway/guac-params";

const CLIP = ["allow", "no_copy", "no_paste", "none"];
const PROTOCOLS = ["RDP", "SSH", "VNC"] as const;

export type SiteValidation =
  | {
      ok: true;
      mode: "TRANSPARENT";
      connectorId: string;
      name: string;
      hostname: string;
      upstreamUrl: string;
      description: string | null;
      insecureSkipVerify: boolean;
      clipboardMode: string;
      recordSessions: boolean;
    }
  | {
      ok: true;
      mode: "GATEWAY";
      connectorId: string;
      name: string;
      description: string | null;
      protocol: "RDP" | "SSH" | "VNC";
      targetHost: string;
      targetPort: number;
      username: string;
      secret: string | null;
      recordSessions: boolean;
      guacParams: GuacParams;
    }
  | {
      ok: true;
      mode: "ISOLATED";
      connectorId: string;
      name: string;
      description: string | null;
      upstreamUrl: string;
      recordSessions: boolean;
      clipboardMode: string;
    }
  | { ok: false; error: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Validates + normalizes a site create/update body, branching by accessMode. Pure
// (no DB/env) so it is unit-tested; the routes do the DB writes with its output.
export function validateSiteInput(
  body: Record<string, unknown>,
  opts: { nativeGateway: boolean; requireSecret: boolean; recordingEnabled: boolean; isolationEnabled: boolean },
): SiteValidation {
  const connectorId = str(body.connectorId);
  const name = str(body.name);
  const description = str(body.description) || null;
  const mode = body.accessMode === "GATEWAY" ? "GATEWAY" : body.accessMode === "ISOLATED" ? "ISOLATED" : "TRANSPARENT";
  if (!connectorId || !name) return { ok: false, error: "connector_name_required" };

  if (mode === "ISOLATED") {
    if (!opts.isolationEnabled) return { ok: false, error: "isolation_disabled" };
    const upstreamUrl = str(body.upstreamUrl);
    if (!upstreamUrl) return { ok: false, error: "isolated_url_required" };
    try {
      const u = new URL(upstreamUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "invalid_upstream_url" };
    } catch { return { ok: false, error: "invalid_upstream_url" }; }
    const clip = str(body.clipboardMode);
    return {
      ok: true, mode: "ISOLATED", connectorId, name, description, upstreamUrl,
      recordSessions: opts.recordingEnabled && body.recordSessions === true,
      clipboardMode: CLIP.includes(clip) ? clip : "allow",
    };
  }

  if (mode === "GATEWAY") {
    if (!opts.nativeGateway) return { ok: false, error: "native_gateway_disabled" };
    const protocol = str(body.protocol).toUpperCase();
    if (!PROTOCOLS.includes(protocol as (typeof PROTOCOLS)[number])) return { ok: false, error: "invalid_protocol" };
    const targetHost = str(body.targetHost);
    const targetPort = typeof body.targetPort === "number" ? body.targetPort : Number(str(body.targetPort));
    const username = str(body.username);
    const secret = typeof body.secret === "string" ? body.secret : "";
    if (!targetHost || !username) return { ok: false, error: "remote_desktop_fields_required" };
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) return { ok: false, error: "invalid_port" };
    if (opts.requireSecret && !secret) return { ok: false, error: "remote_desktop_fields_required" };
    return {
      ok: true,
      mode: "GATEWAY",
      connectorId,
      name,
      description,
      protocol: protocol as "RDP" | "SSH" | "VNC",
      targetHost,
      targetPort,
      username,
      secret: secret || null,
      recordSessions: opts.recordingEnabled && body.recordSessions === true,
      guacParams: parseGuacParams(body.guacParams),
    };
  }

  const hostname = str(body.hostname).toLowerCase();
  const upstreamUrl = str(body.upstreamUrl);
  if (!hostname) return { ok: false, error: "invalid_hostname" };
  if (!upstreamUrl) return { ok: false, error: "connector_name_upstream_required" };
  try {
    const u = new URL(upstreamUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "invalid_upstream_url" };
  } catch {
    return { ok: false, error: "invalid_upstream_url" };
  }
  const clip = str(body.clipboardMode);
  const clipboardMode = CLIP.includes(clip) ? clip : "allow";
  const recordSessions = opts.recordingEnabled && body.recordSessions === true;
  return {
    ok: true,
    mode: "TRANSPARENT",
    connectorId,
    name,
    hostname,
    upstreamUrl,
    description,
    insecureSkipVerify: body.insecureSkipVerify === true,
    clipboardMode,
    recordSessions,
  };
}
