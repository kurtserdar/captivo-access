import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import type { VaultProtocol, VaultSecretKind } from "@/generated/prisma/enums";
import { parseGuacParams, type GuacParams } from "@/lib/gateway/guac-params";

export type VaultInput = {
  siteId: string;
  protocol: VaultProtocol;
  targetHost: string;
  targetPort: number;
  username: string;
  secret: string; // plaintext in; encrypted at rest
  secretKind: VaultSecretKind;
  guacParams?: GuacParams;
};

export async function setVaultCredential(input: VaultInput): Promise<void> {
  const data = {
    protocol: input.protocol,
    targetHost: input.targetHost.trim(),
    targetPort: input.targetPort,
    username: input.username.trim(),
    secret: encrypt(input.secret),
    secretKind: input.secretKind,
    guacParams: parseGuacParams(input.guacParams ?? {}) as Prisma.InputJsonValue,
  };
  await db.vaultCredential.upsert({
    where: { siteId: input.siteId },
    create: { siteId: input.siteId, ...data },
    update: data,
  });
}

// Server-only: returns the decrypted credential. Never expose to a client.
export async function getVaultCredential(siteId: string) {
  const c = await db.vaultCredential.findUnique({ where: { siteId } });
  if (!c) return null;
  return {
    protocol: c.protocol,
    targetHost: c.targetHost,
    targetPort: c.targetPort,
    username: c.username,
    secret: decrypt(c.secret),
    secretKind: c.secretKind,
    guacParams: c.guacParams,
  };
}

export async function hasVaultCredential(siteId: string): Promise<boolean> {
  return (await db.vaultCredential.count({ where: { siteId } })) > 0;
}

// Non-secret fields for seeding the site form (the secret is never returned).
export async function getVaultCredentialMeta(siteId: string) {
  const c = await db.vaultCredential.findUnique({
    where: { siteId },
    select: { protocol: true, targetHost: true, targetPort: true, username: true, guacParams: true },
  });
  return c ? { ...c, hasSecret: true as const } : null;
}

export async function clearVaultCredential(siteId: string): Promise<void> {
  await db.vaultCredential.deleteMany({ where: { siteId } });
}
