import { db } from "@/lib/db";
import { generateToken, hashToken, verifyTokenHash } from "@/lib/auth/tokens";

export async function createPairing(
  name: string,
  opts?: { connectorId?: string },
  ttlMinutes = 15,
): Promise<{ id: string; code: string }> {
  const code = generateToken();
  const p = await db.connectorPairing.create({
    data: {
      name,
      codeHash: await hashToken(code),
      connectorId: opts?.connectorId ?? null,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    },
  });
  return { id: p.id, code };
}

export async function redeemPairing(
  code: string,
  meta: { name?: string; version?: string },
): Promise<{ connectorId: string; token: string } | null> {
  const candidates = await db.connectorPairing.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
  });
  for (const p of candidates) {
    if (await verifyTokenHash(code, p.codeHash)) {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      let connector;
      try {
        connector = await db.$transaction(async (tx) => {
          const consumed = await tx.connectorPairing.updateMany({
            where: { id: p.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          if (consumed.count === 0) throw new Error("PAIRING_ALREADY_USED");
          if (p.connectorId) {
            // Re-pair: rotate the token on the EXISTING connector (preserving its id and
            // its Site bindings) — but ONLY if it isn't REVOKED. The status guard is in
            // the WHERE clause so a concurrent revoke can't be un-done by a redeem race;
            // count === 0 means the connector is gone or has been revoked → stale pairing.
            const rotated = await tx.connector.updateMany({
              where: { id: p.connectorId, status: { not: "REVOKED" } },
              data: { tokenHash, status: "PENDING", version: meta.version ?? undefined },
            });
            if (rotated.count === 0) throw new Error("CONNECTOR_GONE");
            return { id: p.connectorId };
          }
          return tx.connector.create({
            data: { name: meta.name?.trim() || p.name, tokenHash, status: "PENDING", version: meta.version ?? null },
          });
        });
      } catch (err) {
        if (err instanceof Error && (err.message === "PAIRING_ALREADY_USED" || err.message === "CONNECTOR_GONE")) return null;
        throw err;
      }
      return { connectorId: connector.id, token };
    }
  }
  return null;
}

export async function validateConnectorToken(token: string): Promise<{ connectorId: string } | null> {
  const candidates = await db.connector.findMany({ where: { status: { not: "REVOKED" } } });
  for (const c of candidates) {
    if (await verifyTokenHash(token, c.tokenHash)) return { connectorId: c.id };
  }
  return null;
}
