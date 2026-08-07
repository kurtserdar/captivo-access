import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { hashToken, generateToken } from "@/lib/auth/tokens";

// No db-mock helper exists yet in this repo (Slice 1 tests are all pure-logic
// and never touch @/lib/db) — this is the first one, and the pattern below is
// meant to be reused by later tasks that also need a mocked `db`.
vi.mock("@/lib/db", () => ({
  db: {
    connectorPairing: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    connector: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import { createPairing, redeemPairing, validateConnectorToken } from "./enrollment";

// `db` above is statically typed as the real PrismaClient (vi.mock doesn't
// change the import's static type), so we re-view it as its mocked shape to
// call `.mockResolvedValue` etc. without fighting the real Prisma types.
const mockDb = db as unknown as {
  connectorPairing: { create: Mock; findMany: Mock; updateMany: Mock };
  connector: { create: Mock; findMany: Mock };
  $transaction: Mock;
};

// Fake `tx` handed to the `db.$transaction(async (tx) => ...)` callback.
const tx = {
  connectorPairing: { updateMany: vi.fn() },
  connector: { create: vi.fn(), update: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: run the transaction callback against our fake `tx`.
  mockDb.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
});

describe("createPairing", () => {
  it("stores a hashed code and returns the raw code once", async () => {
    mockDb.connectorPairing.create.mockResolvedValueOnce({
      id: "pair-1",
      name: "Branch A",
      codeHash: "irrelevant-hash",
      expiresAt: new Date(),
      usedAt: null,
      createdAt: new Date(),
    });

    const result = await createPairing("Branch A", undefined, 30);

    expect(result.id).toBe("pair-1");
    expect(typeof result.code).toBe("string");
    expect(mockDb.connectorPairing.create).toHaveBeenCalledTimes(1);
    const call = mockDb.connectorPairing.create.mock.calls[0][0];
    expect(call.data.name).toBe("Branch A");
    expect(call.data.codeHash).not.toBe(result.code); // stored value is hashed, not raw
    expect(call.data.expiresAt).toBeInstanceOf(Date);
  });
});

describe("redeemPairing", () => {
  it("redeems a valid pairing exactly once", async () => {
    const code = generateToken();
    const codeHash = await hashToken(code);
    const pairing = {
      id: "pair-1",
      name: "Branch A",
      codeHash,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      usedAt: null,
      createdAt: new Date(),
    };

    // First redemption: the pairing is found (unused, unexpired) and consumed.
    mockDb.connectorPairing.findMany.mockResolvedValueOnce([pairing]);
    tx.connectorPairing.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.connector.create.mockResolvedValueOnce({
      id: "connector-1",
      name: "Branch A",
      tokenHash: "irrelevant-hash",
      status: "PENDING",
      version: null,
      lastSeenAt: null,
      remoteAddr: null,
      createdAt: new Date(),
    });

    const first = await redeemPairing(code, {});

    expect(first).not.toBeNull();
    expect(first?.connectorId).toBe("connector-1");
    expect(typeof first?.token).toBe("string");
    expect(tx.connectorPairing.updateMany).toHaveBeenCalledWith({
      where: { id: "pair-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.connector.create).toHaveBeenCalledWith({
      data: { name: "Branch A", tokenHash: expect.any(String), status: "PENDING", version: null },
    });

    // Second attempt with the same code: now consumed, so a real `findMany`
    // (filtered on `usedAt: null`) would no longer return it.
    mockDb.connectorPairing.findMany.mockResolvedValueOnce([]);

    const second = await redeemPairing(code, {});

    expect(second).toBeNull();
  });

  it("does not redeem an expired pairing", async () => {
    // A real `findMany` filtered on `expiresAt: { gt: new Date() }` would
    // exclude an expired row — simulate that by returning no candidates.
    mockDb.connectorPairing.findMany.mockResolvedValueOnce([]);

    const result = await redeemPairing(generateToken(), {});

    expect(result).toBeNull();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("guards against a concurrent double-redeem inside the transaction", async () => {
    // Two concurrent callers can both read the same unused/unexpired pairing
    // before either commits. The transactional `updateMany` guard is what
    // must stop the loser: `count === 0` means someone else already
    // consumed it. redeemPairing should not create a second connector, and
    // the lost race should surface as `null` (same contract as "no match"),
    // not as a thrown error.
    const code = generateToken();
    const codeHash = await hashToken(code);
    const pairing = {
      id: "pair-2",
      name: "Branch B",
      codeHash,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      usedAt: null,
      createdAt: new Date(),
    };

    mockDb.connectorPairing.findMany.mockResolvedValueOnce([pairing]);
    tx.connectorPairing.updateMany.mockResolvedValueOnce({ count: 0 });

    expect(await redeemPairing(code, {})).toBeNull();
    expect(tx.connector.create).not.toHaveBeenCalled();
  });
});

describe("validateConnectorToken", () => {
  it("validates a live token and rejects a revoked connector", async () => {
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const liveConnector = {
      id: "connector-live",
      name: "Branch A",
      tokenHash,
      status: "PENDING",
      version: null,
      lastSeenAt: null,
      remoteAddr: null,
      createdAt: new Date(),
    };

    mockDb.connector.findMany.mockResolvedValueOnce([liveConnector]);

    const ok = await validateConnectorToken(token);

    expect(ok).toEqual({ connectorId: "connector-live" });

    // A real `findMany` filtered on `status: { not: "REVOKED" }` would
    // exclude a revoked connector — simulate that by returning no candidates.
    mockDb.connector.findMany.mockResolvedValueOnce([]);

    const revoked = await validateConnectorToken(token);

    expect(revoked).toBeNull();
  });
});

describe("redeemPairing re-pair branch (pairing bound to an existing connector)", () => {
  it("updates the existing connector's token instead of creating a new one", async () => {
    const code = generateToken();
    const codeHash = await hashToken(code);
    mockDb.connectorPairing.findMany.mockResolvedValue([
      { id: "pair1", codeHash, name: "HQ", connectorId: "conn-existing", usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    tx.connectorPairing.updateMany.mockResolvedValue({ count: 1 });
    tx.connector.update.mockResolvedValue({ id: "conn-existing" });

    const result = await redeemPairing(code, { version: "1.2.3" });

    expect(result).toEqual({ connectorId: "conn-existing", token: expect.any(String) });
    expect(tx.connector.update).toHaveBeenCalledTimes(1);
    expect(tx.connector.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conn-existing" }, data: expect.objectContaining({ status: "PENDING" }) }),
    );
    expect(tx.connector.create).not.toHaveBeenCalled();
  });

  it("returns null when the target connector no longer exists (P2025)", async () => {
    const code = generateToken();
    const codeHash = await hashToken(code);
    mockDb.connectorPairing.findMany.mockResolvedValue([
      { id: "pair1", codeHash, name: "HQ", connectorId: "conn-gone", usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    tx.connectorPairing.updateMany.mockResolvedValue({ count: 1 });
    tx.connector.update.mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }));

    const result = await redeemPairing(code, {});
    expect(result).toBeNull();
  });

  it("still creates a new connector when the pairing has no connectorId", async () => {
    const code = generateToken();
    const codeHash = await hashToken(code);
    mockDb.connectorPairing.findMany.mockResolvedValue([
      { id: "pair1", codeHash, name: "HQ", connectorId: null, usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    tx.connectorPairing.updateMany.mockResolvedValue({ count: 1 });
    tx.connector.create.mockResolvedValue({ id: "conn-new" });

    const result = await redeemPairing(code, {});
    expect(result).toEqual({ connectorId: "conn-new", token: expect.any(String) });
    expect(tx.connector.create).toHaveBeenCalledTimes(1);
    expect(tx.connector.update).not.toHaveBeenCalled();
  });
});
