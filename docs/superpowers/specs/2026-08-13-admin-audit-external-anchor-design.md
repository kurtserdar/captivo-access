# Admin-Audit External RFC-3161 Anchoring — Design

**Status:** Approved (brainstorm 2026-08-13)
**Backlog:** external RFC-3161 anchoring of the admin-audit chain
**Ships as:** v0.42.0 (manager + migrate; no dataplane, no connector)

## Goal

Extend the external RFC-3161 timestamp anchoring the access-audit chain already
has to the **admin-audit chain**, so the admin action log's head is periodically
notarized by an external TSA — pinning admin history against a later full-DB
rewrite, independent of any Captivo-held key.

## Background (what already exists, reused unchanged)

The access chain has a complete anchor stack, all chain-agnostic where it counts:

- `src/lib/audit/rfc3161.ts` — `buildTimeStampRequest(digest)`,
  `parseTimeStampResponse(der)`, `verifyTimeStampToken(token, preimage)`. Generic.
- `src/lib/audit/anchor.ts` — `anchorPreimage(seq, hash)`, `anchorDigest(seq, hash)`,
  `shouldAnchor(head, last)`, and `runAnchor()` (access-bound).
- `src/lib/audit/anchor-verify.ts` — `verifyOneAnchor(anchor, chainHashAtSeq, deps)`.
  Generic: takes the anchor row, the hash of the event at that seq (from whichever
  table), and a `tokenCheck` dep.
- Settings: `externalAnchorEnabled`, `anchorTsaUrl`, `anchorTsaAuth` (via
  `resolvedExternalAnchorEnabled()`, `resolvedAnchorTsaUrl()`,
  `resolvedAnchorTsaAuth()`).
- Cron `POST /api/cron/audit-anchor` → `runAnchor()`.
- Routes `POST /api/admin/audit/anchors/verify`, `GET /api/admin/audit/anchors/[id]/token`.
- UI: `IntegrityPanel` anchor section (status line + Verify anchors + token download).

The admin chain (v0.36–0.39) already stores its head in `AuditChainState` under
`id = "admin-singleton"` and its rows in `AdminAuditEvent` with
`seq / prevHash / hash`.

## Decisions (resolved in brainstorm)

1. **Storage:** a **new `AdminAuditAnchor` model** mirroring `AuditAnchor`. The
   access anchor table and its routes stay untouched (zero regression risk to the
   working notarized access path). Matches the existing AdminAuditEvent-vs-AuditEvent
   split.
2. **Trigger:** the **same cron** `/api/cron/audit-anchor` anchors both chains in
   one run.
3. **Settings:** reuse the existing TSA settings — one configuration, both chains
   anchored when external anchoring is enabled. No new settings.

## Non-negotiable constraints

- Do **not** change the access anchor path: `runAnchor()` stays behavior-identical,
  `AuditAnchor` untouched, `/api/admin/audit/anchors/*` untouched.
- Do **not** change `rfc3161.ts`, `anchor-verify.ts`, `shouldAnchor`,
  `anchorDigest`, or the settings resolvers — reuse them.

## Schema — new `AdminAuditAnchor`

Mirror of `AuditAnchor`, added to `prisma/schema.prisma`:

```prisma
model AdminAuditAnchor {
  id           String   @id @default(cuid())
  anchoredSeq  BigInt
  anchoredHash String
  tsaUrl       String
  token        Bytes
  genTime      DateTime
  createdAt    DateTime @default(now())

  @@index([anchoredSeq])
  @@index([createdAt])
}
```

Additive, no backfill. Schema change → migrate image bump + `db push`.

## Anchoring op — generalize `runAnchor`

In `src/lib/audit/anchor.ts`, extract the body of the current `runAnchor()` into a
private `runAnchorFor(target)` parameterized by a small adapter, then provide two
thin public bindings. All shared logic (settings gate, `shouldAnchor`,
`anchorDigest`, `buildTimeStampRequest`, TSA fetch with the 15s AbortController
timeout, `parseTimeStampResponse`) is reused verbatim.

```ts
type AnchorTarget = {
  chainStateId: string; // "singleton" | "admin-singleton"
  findLastAnchor: () => Promise<{ anchoredSeq: bigint; anchoredHash: string } | null>;
  createAnchor: (data: {
    anchoredSeq: bigint; anchoredHash: string; tsaUrl: string; token: Uint8Array; genTime: Date;
  }) => Promise<unknown>;
};

async function runAnchorFor(target: AnchorTarget): Promise<AnchorRunResult> { /* current runAnchor body, chainState id + anchor table via target */ }

export async function runAnchor(): Promise<AnchorRunResult> {
  return runAnchorFor({
    chainStateId: "singleton",
    findLastAnchor: () => db.auditAnchor.findFirst({ orderBy: { anchoredSeq: "desc" }, select: { anchoredSeq: true, anchoredHash: true } }),
    createAnchor: (data) => db.auditAnchor.create({ data }),
  });
}

export async function runAdminAnchor(): Promise<AnchorRunResult> {
  return runAnchorFor({
    chainStateId: "admin-singleton",
    findLastAnchor: () => db.adminAuditAnchor.findFirst({ orderBy: { anchoredSeq: "desc" }, select: { anchoredSeq: true, anchoredHash: true } }),
    createAnchor: (data) => db.adminAuditAnchor.create({ data }),
  });
}
```

`runAnchorFor` reads the head via `db.auditChainState.findUnique({ where: { id: target.chainStateId } })` (the admin head lives in the same table under `admin-singleton`). Fail-open behavior (`AnchorRunResult` union, never throws) is preserved.

## Cron — anchor both

`src/app/api/cron/audit-anchor/route.ts` runs both, each independent:

```ts
const access = await runAnchor();
const admin = await runAdminAnchor();
return NextResponse.json({ access, admin });
```

`recordCronRun("audit-anchor")` and the `CRON_SECRET` auth stay as-is. A failure
in one is isolated (each `runAnchor*` is fail-open), so one chain failing never
blocks the other. Existing crontab entry unchanged.

## Verify + token routes (admin mirror)

- **`POST /api/admin/audit/admin-anchors/verify`** — `read_console`-gated. Loads
  `db.adminAuditAnchor.findMany({ orderBy: { anchoredSeq: "asc" } })`; for each,
  looks up `db.adminAuditEvent.findUnique({ where: { seq: a.anchoredSeq }, select: { hash: true } })`
  and calls `verifyOneAnchor(anchor, event?.hash ?? null, { tokenCheck: verifyTimeStampToken })`.
  Returns `{ total, ok, failed, verdicts }`. Structurally identical to the access
  anchors-verify route, only the two table names differ.
- **`GET /api/admin/audit/admin-anchors/[id]/token`** — `read_console`-gated.
  `db.adminAuditAnchor.findUnique` → returns the raw token as
  `application/timestamp-reply`, `filename="admin-anchor-seq-<seq>.tsr"`.

## UI — extend `AdminIntegrityPanel`

Bring the admin panel to parity with the access `IntegrityPanel`'s anchor section:

- The admin branch of `src/app/(app)/admin/audit/page.tsx` computes an anchor
  status prop exactly as the access branch does, but from `adminAuditAnchor` and
  the `admin-singleton` settings resolvers:
  `{ enabled: resolvedExternalAnchorEnabled(), count: adminAuditAnchor.count(), last: adminAuditAnchor.findFirst({ orderBy: { anchoredSeq: "desc" } }) }`,
  passed to `<AdminIntegrityPanel anchor={...} />`.
- `AdminIntegrityPanel` gains an optional `anchor` prop and renders, when
  `anchor.enabled`: an "External anchor" status line (last seq · genTime · count ·
  TSA URL, or "enabled, no anchor recorded yet (runs daily)"), a **Verify anchors**
  button hitting `/api/admin/audit/admin-anchors/verify`, and per-anchor token
  download links to `/api/admin/audit/admin-anchors/[id]/token`. The existing
  **Verify chain** button stays. Reuses the same CSS classes as the access panel.

## Testing

Reality check on the existing harness: `src/lib/audit/anchor.test.ts` tests only
the **pure** helpers (`anchorPreimage`, `anchorDigest`, `shouldAnchor`). There is
**no db/fetch mock harness** — `runAnchor` itself is not unit-tested today; it is
validated by `pnpm build` + manual Gate-A. This slice adds no new pure logic (the
generalization is db-bound plumbing mirroring the already-proven `runAnchor`), so
it introduces **no new unit tests**, consistent with how `runAnchor` is validated.

- `shouldAnchor`, `anchorDigest`, `verifyOneAnchor`, `rfc3161` — already covered by
  existing tests, reused unchanged, not re-tested.
- `pnpm build` typechecks the new routes, the panel prop, the schema client, and
  the `runAnchorFor` refactor (a regression surfaces as a type error).
- Correctness of `runAdminAnchor` + the admin verify/token routes is confirmed by
  **Gate-A** after deploy — the same bar `runAnchor` was held to.

## Deploy

**v0.42.0**, manager + migrate (new `AdminAuditAnchor` table). Bump both tags,
`docker compose run --rm access-migrate` (verify "in sync"), then
`up -d access-manager`. No dataplane, no connector. After deploy, one manual
`POST /api/cron/audit-anchor` (with `CRON_SECRET`) mints the first admin anchor;
then Gate-A.

Gate-A: with external anchoring enabled + a TSA URL configured, POST the cron →
`{ access: {...}, admin: { status: "anchored", ... } }`; the Admin-actions tab
shows the External-anchor status line; **Verify anchors** → all ok; download a
`.tsr`; a second cron run with no new admin events → `admin: { status: "skipped" }`.

## Out of scope

- New TSA configuration or settings UI (reuses the existing one).
- A separate admin cron endpoint.
- Any change to the access anchor path or the shared rfc3161 / anchor-verify code.
- Backfilling anchors for historical admin heads (anchoring is forward-looking;
  the chain-hash + first anchor pin everything from here).
