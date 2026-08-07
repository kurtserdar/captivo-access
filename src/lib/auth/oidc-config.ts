import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

const ID = "singleton";

export type OidcConfigView = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  buttonLabel: string | null;
  hasSecret: boolean;
  lastVerifiedAt: Date | null;
  lastVerifiedOk: boolean | null;
  lastVerifiedDetail: string | null;
};

export async function getOidcConfig(): Promise<OidcConfigView | null> {
  let c;
  try {
    c = await db.oidcConfig.findUnique({ where: { id: ID } });
  } catch {
    // If the table doesn't exist yet (deployed before db push) or the DB is
    // unavailable, treat SSO as unconfigured so passkey login still works.
    return null;
  }
  if (!c) return null;
  return {
    enabled: c.enabled,
    issuer: c.issuer,
    clientId: c.clientId,
    buttonLabel: c.buttonLabel,
    hasSecret: c.clientSecret.length > 0,
    lastVerifiedAt: c.lastVerifiedAt,
    lastVerifiedOk: c.lastVerifiedOk,
    lastVerifiedDetail: c.lastVerifiedDetail,
  };
}

export async function getOidcSecret(): Promise<string | null> {
  const c = await db.oidcConfig.findUnique({ where: { id: ID }, select: { clientSecret: true } });
  if (!c || !c.clientSecret) return null;
  return decrypt(c.clientSecret);
}

export async function saveOidcConfig(input: {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  buttonLabel?: string | null;
}): Promise<void> {
  const issuer = input.issuer.trim();
  const clientId = input.clientId.trim();
  const buttonLabel = input.buttonLabel?.trim() || null;
  const secretProvided = typeof input.clientSecret === "string" && input.clientSecret.length > 0;
  const encSecret = secretProvided ? encrypt(input.clientSecret!.trim()) : undefined;

  await db.oidcConfig.upsert({
    where: { id: ID },
    create: { id: ID, enabled: input.enabled, issuer, clientId, clientSecret: encSecret ?? "", buttonLabel },
    update: {
      enabled: input.enabled,
      issuer,
      clientId,
      buttonLabel,
      ...(encSecret !== undefined ? { clientSecret: encSecret } : {}),
    },
  });
}
