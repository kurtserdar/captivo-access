import { base, db } from "@/lib/db";
import { generateToken, hashToken, verifyTokenHash } from "@/lib/auth/tokens";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { withTenant } from "@/lib/tenant/scope";

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

// Shape of a single row from the Task-2 SECURITY DEFINER
// `list_pairing_candidates()` — cross-tenant, RLS-bypass, used ONLY to find
// which row's codeHash a raw pair code verifies against (codeHash is
// argon2 — no column-equality lookup is possible). It deliberately carries
// less than the full ConnectorPairing row (no connectorId/name): once matched,
// the full row is re-fetched under the adopted tenant's own RLS scope.
type PairingCandidateRow = { id: string; tenantId: string; codeHash: string; expiresAt: Date; usedAt: Date | null };

// Shape of a row from `list_connector_token_candidates()` — same rationale,
// for bearer-token auth: cross-tenant scan to find which connector's
// tokenHash a bearer token verifies against.
type ConnectorTokenCandidateRow = { id: string; tenantId: string; tokenHash: string };

async function scanPairingCandidates(): Promise<PairingCandidateRow[]> {
  return base.$queryRawUnsafe<PairingCandidateRow[]>(`SELECT * FROM list_pairing_candidates()`);
}

async function scanConnectorTokenCandidates(): Promise<ConnectorTokenCandidateRow[]> {
  return base.$queryRawUnsafe<ConnectorTokenCandidateRow[]>(`SELECT * FROM list_connector_token_candidates()`);
}

// Consumes a matched, still-valid pairing row and creates/rotates its
// connector. Shared by both the flag-off (plain scan) and flag-on
// (cross-tenant scan -> adopt tenant -> re-fetch) paths in `redeemPairing`,
// so the actual write logic (and its race-guard semantics) lives in one place.
async function finishRedeem(
  p: { id: string; name: string; connectorId: string | null },
  meta: { name?: string; version?: string },
): Promise<{ connectorId: string; token: string } | null> {
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

export async function redeemPairing(
  code: string,
  meta: { name?: string; version?: string },
): Promise<{ connectorId: string; token: string } | null> {
  if (multiTenantEnabled()) {
    // Cloud: `db.connectorPairing.findMany()` with no ambient tenant scope
    // returns nothing under RLS (fail-closed) — the pairing's tenant is
    // unknown until the code is verified. Scan cross-tenant via the DEFINER
    // list, argon2-verify each candidate, then adopt the matched row's tenant.
    const now = new Date();
    const candidates = await scanPairingCandidates();
    for (const p of candidates) {
      if (p.usedAt !== null || p.expiresAt <= now) continue;
      if (await verifyTokenHash(code, p.codeHash)) {
        return withTenant(p.tenantId, async () => {
          // Re-fetch the full row now that we're scoped to its tenant (RLS
          // allows it): the candidate list only carries id/tenantId/codeHash/
          // expiresAt/usedAt, not connectorId/name. Re-check liveness too —
          // it's the same race the flag-off path guards against, just with a
          // gap between the cross-tenant scan and this scoped re-fetch.
          const full = await db.connectorPairing.findUnique({ where: { id: p.id } });
          if (!full || full.usedAt !== null || full.expiresAt <= new Date()) return null;
          return finishRedeem(full, meta);
        });
      }
    }
    return null;
  }

  const candidates = await db.connectorPairing.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
  });
  for (const p of candidates) {
    if (await verifyTokenHash(code, p.codeHash)) {
      return finishRedeem(p, meta);
    }
  }
  return null;
}

export async function validateConnectorToken(
  token: string,
): Promise<{ connectorId: string; tenantId?: string } | null> {
  if (multiTenantEnabled()) {
    // Same rationale as redeemPairing: scan cross-tenant via the DEFINER list
    // (tokenHash is argon2 — no column-equality lookup), then adopt the
    // matched row's tenant.
    const candidates = await scanConnectorTokenCandidates();
    for (const c of candidates) {
      if (await verifyTokenHash(token, c.tokenHash)) {
        return withTenant(c.tenantId, async () => {
          // The candidate list carries only id/tenantId/tokenHash, not status
          // — and revoking a connector never changes its tokenHash, so a
          // REVOKED connector's token still verifies above. Re-check liveness
          // under the adopted tenant's own RLS scope before granting auth.
          const live = await db.connector.findUnique({ where: { id: c.id }, select: { status: true } });
          if (!live || live.status === "REVOKED") return null;
          return { connectorId: c.id, tenantId: c.tenantId };
        });
      }
    }
    return null;
  }

  const candidates = await db.connector.findMany({ where: { status: { not: "REVOKED" } } });
  for (const c of candidates) {
    if (await verifyTokenHash(token, c.tokenHash)) return { connectorId: c.id };
  }
  return null;
}
