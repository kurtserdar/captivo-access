// The acting tenant's commercial/technical envelope (Cloud): per-tenant
// capability overrides and limits set from the platform console. Self-host
// (flag off): empty — every check passes and the env flags alone decide.
import { db } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant/context";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { parseLimits, parseCapabilities, withinLimit, type TenantLimits, type TenantCapabilities, type CapabilityKey, type LimitKey } from "@/lib/platform/tenant-shape";
import { recordingEnabled } from "@/lib/recording/enabled";
import { isolationEnabled } from "@/lib/isolation/enabled";
import { nativeGatewayEnabled } from "@/lib/gateway/native";
import { vaultEnabled } from "@/lib/vault/enabled";

export interface TenantEnvelope { limits: TenantLimits; capabilities: TenantCapabilities }
const EMPTY: TenantEnvelope = { limits: {}, capabilities: {} };
const CACHE_MS = 15_000;
const cache = new Map<string, { e: TenantEnvelope; at: number }>();

export async function tenantEnvelope(): Promise<TenantEnvelope> {
  if (!multiTenantEnabled()) return EMPTY;
  const tid = currentTenantId();
  const hit = cache.get(tid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.e;
  let e = EMPTY;
  try {
    const t = await db.tenant.findUnique({ where: { id: tid }, select: { limits: true, capabilities: true } });
    e = { limits: parseLimits(t?.limits), capabilities: parseCapabilities(t?.capabilities) };
  } catch {
    e = EMPTY;
  }
  cache.set(tid, { e, at: Date.now() });
  return e;
}

function envDefault(key: CapabilityKey): boolean {
  switch (key) {
    case "recording": return recordingEnabled();
    case "isolated": return isolationEnabled();
    case "gateway": return nativeGatewayEnabled();
    case "vault": return vaultEnabled();
  }
}

// Effective capability: the tenant override when set, else the deployment flag.
export async function capabilityAllowed(key: CapabilityKey): Promise<boolean> {
  const { capabilities } = await tenantEnvelope();
  return capabilities[key] ?? envDefault(key);
}

export class LimitError extends Error {
  code = "limit_reached" as const;
  constructor(public key: LimitKey, public max: number) { super(`limit_reached:${key}`); }
}

// Throws LimitError when adding one more of `key` would exceed the tenant's limit.
export async function assertWithinLimit(key: LimitKey, currentCount: number): Promise<void> {
  const { limits } = await tenantEnvelope();
  if (!withinLimit(limits, key, currentCount)) throw new LimitError(key, limits[key]!);
}

// Caps a tenant-chosen retention (0 = forever) by the platform limit, if any.
export async function capRecordingRetention(days: number): Promise<number> {
  const { limits } = await tenantEnvelope();
  const max = limits.maxRecordingRetentionDays;
  if (max === undefined) return days;
  return days === 0 ? max : Math.min(days, max);
}
