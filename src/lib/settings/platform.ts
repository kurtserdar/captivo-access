import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { parseGuacParams, type GuacParams } from "@/lib/gateway/guac-params";

// Tenant-wide operational settings, editable from /admin/policy. Each was
// previously env-only; the resolvers below read the DB value first, fall back
// to the old env var, then a hard default — so a set env var still works but is
// no longer required, and the UI value wins when present.

export interface PlatformSettings {
  auditRetentionDays: number | null;
  inviteTtlHours: number | null;
  notificationWebhookUrl: string | null;
  vendorIpAllowlist: string | null;
  maxGrantDays: number | null;
  recordingConsentRequired: boolean | null;
  recordingRetentionDays: number | null;
  defaultConnectorLogLevel: string | null;
  externalAnchorEnabled: boolean | null;
  anchorTsaUrl: string | null;
  anchorTsaAuth: string | null;
  notifySiteHealth: boolean | null;
  notifyAccessRequests: boolean | null;
  notifyAccessDecisions: boolean | null;
}

const ID = "singleton";
const EMPTY: PlatformSettings = {
  auditRetentionDays: null,
  inviteTtlHours: null,
  notificationWebhookUrl: null,
  vendorIpAllowlist: null,
  maxGrantDays: null,
  recordingConsentRequired: null,
  recordingRetentionDays: null,
  defaultConnectorLogLevel: null,
  externalAnchorEnabled: null,
  anchorTsaUrl: null,
  anchorTsaAuth: null,
  notifySiteHealth: null,
  notifyAccessRequests: null,
  notifyAccessDecisions: null,
};

let cache: { s: PlatformSettings; at: number } | null = null;

export async function getPlatformSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.s;
  let c;
  try {
    c = await db.platformSettings.findUnique({ where: { id: ID } });
  } catch {
    return EMPTY; // table missing / DB down -> resolvers fall back to env/default
  }
  const s: PlatformSettings = {
    auditRetentionDays: c?.auditRetentionDays ?? null,
    inviteTtlHours: c?.inviteTtlHours ?? null,
    notificationWebhookUrl: c?.notificationWebhookUrl ?? null,
    vendorIpAllowlist: c?.vendorIpAllowlist ?? null,
    maxGrantDays: c?.maxGrantDays ?? null,
    recordingConsentRequired: c?.recordingConsentRequired ?? null,
    recordingRetentionDays: c?.recordingRetentionDays ?? null,
    defaultConnectorLogLevel: c?.defaultConnectorLogLevel ?? null,
    externalAnchorEnabled: c?.externalAnchorEnabled ?? null,
    anchorTsaUrl: c?.anchorTsaUrl ?? null,
    anchorTsaAuth: c?.anchorTsaAuth ?? null,
    notifySiteHealth: c?.notifySiteHealth ?? null,
    notifyAccessRequests: c?.notifyAccessRequests ?? null,
    notifyAccessDecisions: c?.notifyAccessDecisions ?? null,
  };
  cache = { s, at: Date.now() };
  return s;
}

export async function savePlatformSettings(input: PlatformSettings): Promise<void> {
  await db.platformSettings.upsert({
    where: { id: ID },
    create: { id: ID, ...input },
    update: { ...input },
  });
  cache = null;
}

// Global default Guacamole connection params (curated allowlist). Kept out of the
// generic PlatformSettings interface/save to avoid Prisma Json-null friction.
export async function resolvedGuacParamDefaults(): Promise<GuacParams> {
  try {
    const c = await db.platformSettings.findUnique({ where: { id: ID }, select: { guacParamDefaults: true } });
    return parseGuacParams(c?.guacParamDefaults);
  } catch {
    return {};
  }
}

export async function saveGuacParamDefaults(p: GuacParams): Promise<void> {
  const value = parseGuacParams(p) as Prisma.InputJsonValue;
  await db.platformSettings.upsert({
    where: { id: ID },
    create: { id: ID, guacParamDefaults: value },
    update: { guacParamDefaults: value },
  });
  cache = null;
}

function envInt(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Resolved values: DB → env → default.
export async function resolvedAuditRetentionDays(): Promise<number> {
  const s = await getPlatformSettings();
  const v = s.auditRetentionDays ?? envInt("AUDIT_RETENTION_DAYS");
  return v !== null && v >= 0 ? v : 730;
}

export async function resolvedInviteTtlHours(): Promise<number> {
  const s = await getPlatformSettings();
  const v = s.inviteTtlHours ?? envInt("INVITE_TTL_HOURS");
  return v !== null && v > 0 ? v : 48;
}

export async function resolvedNotificationWebhookUrl(): Promise<string> {
  const s = await getPlatformSettings();
  return (s.notificationWebhookUrl ?? process.env.NOTIFICATION_WEBHOOK_URL ?? "").trim();
}

// Raw vendor source-IP allowlist (CIDRs/IPs). Empty = no restriction. No env
// fallback — this is a new, UI-only control.
export async function resolvedVendorIpAllowlist(): Promise<string> {
  const s = await getPlatformSettings();
  return (s.vendorIpAllowlist ?? "").trim();
}

// Max grant duration in days; 0 = no cap. UI-only (no env).
export async function resolvedMaxGrantDays(): Promise<number> {
  const s = await getPlatformSettings();
  return s.maxGrantDays && s.maxGrantDays > 0 ? s.maxGrantDays : 0;
}

// Recording consent gate: DB value first, else the RECORDING_CONSENT_REQUIRED
// env (1/true/on/yes), else false.
export async function resolvedRecordingConsentRequired(): Promise<boolean> {
  const s = await getPlatformSettings();
  if (s.recordingConsentRequired !== null) return s.recordingConsentRequired;
  const v = process.env.RECORDING_CONSENT_REQUIRED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

// Recording retention in days; 0 = keep forever. UI-only (no env).
export async function resolvedRecordingRetentionDays(): Promise<number> {
  const s = await getPlatformSettings();
  return s.recordingRetentionDays && s.recordingRetentionDays > 0 ? s.recordingRetentionDays : 0;
}

const LOG_LEVELS = ["debug", "info", "warn", "error"];

// Fleet default connector log level — applied to connectors whose own level is
// null ("use default"). Falls back to info.
export async function resolvedDefaultConnectorLogLevel(): Promise<string> {
  const s = await getPlatformSettings();
  const v = s.defaultConnectorLogLevel;
  return v && LOG_LEVELS.includes(v) ? v : "info";
}

// The level actually pushed to a connector: its own explicit level, else the
// fleet default. Central so the status route and live push agree.
export async function resolvedConnectorLogLevel(own: string | null): Promise<string> {
  if (own && LOG_LEVELS.includes(own)) return own;
  return resolvedDefaultConnectorLogLevel();
}

// External anchor (RFC 3161). Opt-in, off by default; no env fallback, no bundled TSA.
export async function resolvedExternalAnchorEnabled(): Promise<boolean> {
  const s = await getPlatformSettings();
  return s.externalAnchorEnabled === true;
}

export async function resolvedAnchorTsaUrl(): Promise<string> {
  const s = await getPlatformSettings();
  return (s.anchorTsaUrl ?? "").trim();
}

export async function resolvedAnchorTsaAuth(): Promise<string> {
  const s = await getPlatformSettings();
  return (s.anchorTsaAuth ?? "").trim();
}
