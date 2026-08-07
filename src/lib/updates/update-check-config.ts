import { db } from "@/lib/db";

const ID = "singleton";

export type UpdateCheckView = {
  enabled: boolean;
  latestVersion: string | null;
  latestUrl: string | null;
  lastCheckedAt: Date | null;
  lastCheckOk: boolean | null;
};

export async function getUpdateCheckConfig(): Promise<UpdateCheckView | null> {
  let c;
  try {
    c = await db.updateCheckConfig.findUnique({ where: { id: ID } });
  } catch {
    // Table missing (deployed before db push) or DB down → feature off.
    return null;
  }
  // Row missing but the table exists → default-on with no cached result yet.
  if (!c) return { enabled: true, latestVersion: null, latestUrl: null, lastCheckedAt: null, lastCheckOk: null };
  return {
    enabled: c.enabled,
    latestVersion: c.latestVersion,
    latestUrl: c.latestUrl,
    lastCheckedAt: c.lastCheckedAt,
    lastCheckOk: c.lastCheckOk,
  };
}

export async function setUpdateCheckEnabled(enabled: boolean): Promise<void> {
  await db.updateCheckConfig.upsert({ where: { id: ID }, create: { id: ID, enabled }, update: { enabled } });
}

// Persist a check result. On failure (ok=false) the cached latestVersion/latestUrl
// are left intact (only the timestamp + ok flag update); on success they're set.
export async function saveUpdateCheckResult(r: { latestVersion: string | null; latestUrl: string | null; ok: boolean }): Promise<void> {
  await db.updateCheckConfig.upsert({
    where: { id: ID },
    create: { id: ID, latestVersion: r.latestVersion, latestUrl: r.latestUrl, lastCheckedAt: new Date(), lastCheckOk: r.ok },
    update: {
      lastCheckedAt: new Date(),
      lastCheckOk: r.ok,
      ...(r.ok ? { latestVersion: r.latestVersion, latestUrl: r.latestUrl } : {}),
    },
  });
}
