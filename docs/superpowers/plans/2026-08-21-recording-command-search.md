# Recording Command Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins search the recordings list by the commands typed inside recorded gateway sessions, without weakening at-rest encryption.

**Architecture:** A new `cmd` filter triggers an in-memory decrypt-scan of `SessionKeyEvent` rows for the candidate recordings, bounded by a hard cap that returns a "narrow your filters" signal instead of scanning a huge corpus. Pure helpers do the matching/scan; the query layer orchestrates; the list route and table UI expose it.

**Tech Stack:** Next.js 16 (App Router), Prisma, `@/lib/crypto` (AES-256-GCM), React client component, Vitest.

## Global Constraints

- **English only** — code, comments, UI strings, commit messages, release notes (public OSS repo).
- **No Claude signature** in commits.
- **Manager-only**: no Prisma schema change, no `db push`, no dataplane/connector change.
- Encryption preserved: never store plaintext commands; search decrypts in memory.
- **Masked events are never scanned** — filter `masked: false` at the query level so `••••` (post-`sudo`) lines are never decrypted or matched.
- `COMMAND_SCAN_CAP = 50_000` non-masked candidate events; over that → `too_broad` signal, no scan.
- Authorization unchanged: the list route is already `configure`-gated.
- `cmd` and the existing `q` (host) are independent, combined with AND.
- Do NOT deploy or write release notes without explicit user approval.

---

### Task 1: `cmd` filter field + parsing

**Files:**
- Modify: `src/lib/recording/filter.ts`
- Test: `src/lib/recording/filter.test.ts` (create if absent)

**Interfaces:**
- Produces: `RecordingFilter.cmd?: string`, parsed by `parseRecordingFilter`. Consumed by Tasks 3–5. `buildRecordingWhere` is intentionally unchanged (the command match is not expressible as a Prisma `where`).

- [ ] **Step 1: Write the failing test.** Add to `src/lib/recording/filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseRecordingFilter } from "./filter";

function sp(obj: Record<string, string>) {
  return new URLSearchParams(obj);
}

describe("parseRecordingFilter cmd", () => {
  it("parses and trims cmd", () => {
    const f = parseRecordingFilter(sp({ cmd: "  rm -rf  " }), { defaultLimit: 50, maxLimit: 200 });
    expect(f.cmd).toBe("rm -rf");
  });
  it("cmd absent → undefined", () => {
    const f = parseRecordingFilter(sp({}), { defaultLimit: 50, maxLimit: 200 });
    expect(f.cmd).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test -- src/lib/recording/filter.test.ts`
Expected: FAIL (`cmd` not on the parsed object).

- [ ] **Step 3: Implement.** In `src/lib/recording/filter.ts`:
  - Add `cmd?: string;` to the `RecordingFilter` interface.
  - In `parseRecordingFilter`, add `const cmd = sp.get("cmd")?.trim() || undefined;` and include `cmd` in the returned object.
  - Leave `buildRecordingWhere` unchanged.

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test -- src/lib/recording/filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/recording/filter.ts src/lib/recording/filter.test.ts
git commit -m "feat(recordings): add cmd filter field + parsing"
```

---

### Task 2: Decrypt-scan helpers (TDD)

**Files:**
- Create: `src/lib/recording/command-search.ts`
- Test: `src/lib/recording/command-search.test.ts`

**Interfaces:**
- Consumes: `decryptBytes` from `@/lib/crypto`.
- Produces:
  - `commandTextMatches(decrypted: string, query: string): boolean` — case-insensitive substring.
  - `scanDecryptedMatches(events: { recordingKey: string; data: Uint8Array }[], query: string): Set<string>` — decrypts each, returns the set of `recordingKey`s that match. (Caller pre-filters `masked=false`.)
  - `const COMMAND_SCAN_CAP = 50_000;`
  Consumed by Task 3.

- [ ] **Step 1: Write the failing test.** Create `src/lib/recording/command-search.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { commandTextMatches, scanDecryptedMatches } from "./command-search";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
});

describe("commandTextMatches", () => {
  it("matches case-insensitive substring", () => {
    expect(commandTextMatches("sudo systemctl restart nginx", "SYSTEMCTL")).toBe(true);
    expect(commandTextMatches("ls -la", "rm")).toBe(false);
  });
  it("empty query never matches", () => {
    expect(commandTextMatches("anything", "")).toBe(false);
  });
});

describe("scanDecryptedMatches", () => {
  it("returns recordingKeys whose decrypted text contains the query", async () => {
    const { encryptBytes } = await import("@/lib/crypto");
    const enc = (s: string) => new Uint8Array(encryptBytes(Buffer.from(s, "utf8")));
    const events = [
      { recordingKey: "recA", data: enc("rm -rf /tmp/x") },
      { recordingKey: "recB", data: enc("ls -la") },
      { recordingKey: "recA", data: enc("whoami") },
    ];
    const hits = scanDecryptedMatches(events, "rm -rf");
    expect([...hits]).toEqual(["recA"]);
  });
  it("skips undecryptable rows without throwing", () => {
    const hits = scanDecryptedMatches([{ recordingKey: "bad", data: new Uint8Array([1, 2, 3]) }], "x");
    expect(hits.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test -- src/lib/recording/command-search.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Create `src/lib/recording/command-search.ts`:

```ts
import { decryptBytes } from "@/lib/crypto";

// Cap on how many non-masked keystroke events a single command search will
// decrypt. Above this the caller returns a "narrow your filters" signal rather
// than scanning — keeps search fast and bounded on a large corpus.
export const COMMAND_SCAN_CAP = 50_000;

// Case-insensitive substring. Empty query never matches (avoids "match all").
export function commandTextMatches(decrypted: string, query: string): boolean {
  if (!query) return false;
  return decrypted.toLowerCase().includes(query.toLowerCase());
}

// Decrypt each event's text and collect the recordingKeys that match. A row that
// fails to decrypt is skipped (never throws) — one corrupt chunk can't break the
// whole search. Callers pass only non-masked events.
export function scanDecryptedMatches(
  events: { recordingKey: string; data: Uint8Array }[],
  query: string,
): Set<string> {
  const hits = new Set<string>();
  for (const e of events) {
    if (hits.has(e.recordingKey)) continue; // already matched this recording
    let text: string;
    try {
      text = decryptBytes(Buffer.from(e.data)).toString("utf8");
    } catch {
      continue;
    }
    if (commandTextMatches(text, query)) hits.add(e.recordingKey);
  }
  return hits;
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test -- src/lib/recording/command-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/recording/command-search.ts src/lib/recording/command-search.test.ts
git commit -m "feat(recordings): decrypt-scan command-match helpers + tests"
```

---

### Task 3: Two-phase command search in the query layer

**Files:**
- Modify: `src/lib/recording/query.ts`

**Interfaces:**
- Consumes: `RecordingFilter.cmd` (Task 1); `scanDecryptedMatches`, `COMMAND_SCAN_CAP` (Task 2).
- Produces: `listRecordings` returns `{ rows: RecordingRow[]; total: number; tooBroad?: boolean }`. Consumed by Task 4.

- [ ] **Step 1: Implement the two-phase flow.** In `src/lib/recording/query.ts`, change the return type to include `tooBroad?: boolean` and branch when `filter.cmd` is set:

```ts
import { db } from "@/lib/db";
import { buildRecordingWhere, type RecordingFilter } from "./filter";
import { scanDecryptedMatches, COMMAND_SCAN_CAP } from "./command-search";

// ...RecordingRow interface unchanged...

export async function listRecordings(
  filter: RecordingFilter,
): Promise<{ rows: RecordingRow[]; total: number; tooBroad?: boolean }> {
  const baseWhere = buildRecordingWhere(filter);
  const cmd = filter.cmd?.trim();

  if (cmd && cmd.length >= 2) {
    // Phase 1: candidate recordings under the other filters that actually have
    // keystroke events. keystrokeLogging is opt-in, so most recordings have
    // none and are never scanned.
    const candidates = await db.sessionRecording.findMany({
      where: baseWhere,
      select: { recordingKey: true },
    });
    const candidateKeys = candidates.map((c) => c.recordingKey);
    if (candidateKeys.length === 0) return { rows: [], total: 0 };

    // Phase 2 (cap): count non-masked events for the candidates; bail if huge.
    const eventCount = await db.sessionKeyEvent.count({
      where: { recordingKey: { in: candidateKeys }, masked: false },
    });
    if (eventCount > COMMAND_SCAN_CAP) return { rows: [], total: 0, tooBroad: true };

    // Phase 3: decrypt-scan.
    const events = await db.sessionKeyEvent.findMany({
      where: { recordingKey: { in: candidateKeys }, masked: false },
      select: { recordingKey: true, data: true },
    });
    const matchedKeys = scanDecryptedMatches(
      events.map((e) => ({ recordingKey: e.recordingKey, data: e.data as unknown as Uint8Array })),
      cmd,
    );
    if (matchedKeys.size === 0) return { rows: [], total: 0 };

    // Phase 4: list matches (still honouring baseWhere + paging).
    const where = { ...baseWhere, recordingKey: { in: [...matchedKeys] } };
    const [rows, total] = await Promise.all([
      db.sessionRecording.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: filter.offset,
        take: filter.limit,
        select: { id: true, siteId: true, userId: true, host: true, startedAt: true, lastEventAt: true, eventCount: true, bytes: true, format: true, protocol: true },
      }),
      db.sessionRecording.count({ where }),
    ]);
    return { rows, total };
  }

  const where = baseWhere;
  const [rows, total] = await Promise.all([
    db.sessionRecording.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: filter.offset,
      take: filter.limit,
      select: { id: true, siteId: true, userId: true, host: true, startedAt: true, lastEventAt: true, eventCount: true, bytes: true, format: true, protocol: true },
    }),
    db.sessionRecording.count({ where }),
  ]);
  return { rows, total };
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/recording/query.ts
git commit -m "feat(recordings): two-phase command search with scan cap in the query layer"
```

---

### Task 4: Surface `tooBroad` from the list route

**Files:**
- Modify: `src/app/api/admin/recordings/route.ts`

**Interfaces:**
- Consumes: `listRecordings` returning `tooBroad` (Task 3). `parseRecordingFilter` already parses `cmd` (Task 1) — no route parsing change needed.
- Produces: JSON `{ rows, total, tooBroad? }`. Consumed by Task 5.

- [ ] **Step 1: Pass `tooBroad` through.** In `src/app/api/admin/recordings/route.ts`, capture it from `listRecordings` and include it in the response:

```ts
  const { rows, total, tooBroad } = await listRecordings(filter);
  // ...existing user/site enrichment into `out`...
  return NextResponse.json({ rows: out, total, tooBroad: tooBroad ?? false });
```

(When `tooBroad`, `rows` is already empty from the query layer, so the existing enrichment maps over `[]` harmlessly.)

- [ ] **Step 2: Typecheck.**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/admin/recordings/route.ts
git commit -m "feat(recordings): return tooBroad from the recordings list route"
```

---

### Task 5: "Search commands" input + too-broad notice

**Files:**
- Modify: `src/app/(app)/admin/recordings/recordings-table.tsx`

**Interfaces:**
- Consumes: the route's `cmd` param + `tooBroad` response field.

- [ ] **Step 1: Extend the Filters type + state.**
  - In the `Filters` type add `cmd: string;`.
  - In `useState<Filters>({ ... })` add `cmd: ""`.
  - Add `const [tooBroad, setTooBroad] = useState(false);`.

- [ ] **Step 2: Send `cmd` + read `tooBroad` in `load`.**
  - In `load`, after the `q` line add: `if (nextFilters.cmd.trim()) sp.set("cmd", nextFilters.cmd.trim());`
  - Widen the parsed body type to `{ rows: RecordingRowJSON[]; total: number; tooBroad?: boolean }` and after `setTotal(body.total);` add `setTooBroad(body.tooBroad ?? false);`.

- [ ] **Step 3: Add the command search input.** After the host search `field field-search` block, add a sibling:

```tsx
        <div className="field field-search">
          <label className="field-label" htmlFor="rec-filter-cmd">Search commands</label>
          <input
            id="rec-filter-cmd"
            type="search"
            className="input"
            placeholder="e.g. rm -rf, systemctl…"
            value={filters.cmd}
            onChange={(e) => {
              const cmd = e.target.value;
              setFilters((prev) => ({ ...prev, cmd }));
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => void load({ ...filters, cmd }, 0), 300);
            }}
          />
        </div>
```

- [ ] **Step 4: Render the too-broad notice.** Where the table body / rows are rendered, when `tooBroad` is true show a notice instead of the rows, e.g. above the table:

```tsx
      {tooBroad && (
        <p className="notice">Too many recordings to search by command — narrow by vendor, resource, or date and try again.</p>
      )}
```

(Match the file's existing empty/notice styling; if it uses a different class than `notice`, use that.)

- [ ] **Step 5: Typecheck + full test suite.**

Run: `pnpm build && pnpm test`
Expected: PASS (existing 457 + Task 1/2 additions).

- [ ] **Step 6: Commit.**

```bash
git add "src/app/(app)/admin/recordings/recordings-table.tsx"
git commit -m "feat(recordings): Search commands input + too-broad notice"
```

---

## Deploy (SEPARATE — needs explicit user approval, do not run as part of implementation)

- Manager-only; no schema/`db push`, no dataplane/connector.
- Tag the release; bump prod compose manager (+ migrate for tag discipline — schema unchanged, clean no-op).
- Smoke: `/admin/recordings` shows both search fields; a command query returns matching recordings; a masked line (post-`sudo`) is not matched.
- English user-facing release note.

## Self-Review

- **Spec coverage:** cmd field (T1), decrypt-scan + cap + masking-exclusion (T2 helper + T3 query `masked:false`), two-phase flow + tooBroad (T3), route passthrough (T4), UI field + notice (T5). All spec sections mapped.
- **Placeholder scan:** none — every code step has concrete content; the UI notice step notes "match the file's existing notice class" because the exact class must match neighbours, but the intended markup/copy is given.
- **Type consistency:** `RecordingFilter.cmd` (T1) used in T3; `scanDecryptedMatches`/`COMMAND_SCAN_CAP` signatures identical across T2 (def) and T3 (call); `tooBroad` flows query (T3) → route (T4) → table (T5) with the same name; `listRecordings` return type widened once in T3 and consumed in T4.
- **Masking:** enforced in T3 via `masked: false` on both the count and the fetch, so `scanDecryptedMatches` never sees a masked row.
