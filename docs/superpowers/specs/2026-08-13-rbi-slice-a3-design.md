# RBI (Isolated Browser) — Slice A3: Clipboard Control + Recording — Design

**Status:** Approved (brainstorm 2026-08-13). Tight scope: clipboard control for ISOLATED + verify recording. Navigation-lock, download-block, idle-tuning explicitly deferred.
**Backlog:** Pro layer, RBI. Slice A3 of A1/A2/A3 (A1 v0.58.0, A2 v0.59.0 shipped).
**Ships as:** v0.60.0 (**manager only** — descriptor + site form; no data-plane, image, or schema change).

## Why manager-only

- **Recording already works.** The data-plane records the guac *stream* (`guactunnel.go` `if record { newRecWriter(...) }`), protocol-agnostic, so it captures VNC/ISOLATED. The descriptor already returns `record = recordingEnabled() && site.recordSessions`, and the A1 form/validate/routes already store `recordSessions`. → A3 only **verifies** it at Gate A; no code.
- **Clipboard rides the descriptor `params`.** `toGuacArgs` maps `clipboardMode → disable-copy/disable-paste`; the data-plane's `buildConnect` fills whatever arg guacd advertises from `conn.Params` (VNC advertises `disable-copy`/`disable-paste`). So applying clipboard for ISOLATED is a manager change only — no data-plane change.

## The gap being closed

The ISOLATED descriptor branch hardcodes `params: {}`, so an isolated session **cannot block copy-out** even though the Site stores a `clipboardMode`. And the A1 form exposes no clipboard control for the ISOLATED type. For RBI (containment is the point), blocking copy-out of the isolated browser is the single highest-value data-leak control.

## Changes

### 1. Descriptor — `src/app/api/internal/gateway/descriptor/route.ts`

In the ISOLATED branch, replace `params: {}` with the clipboard args derived from the
site's `clipboardMode` (empty GuacParams, VNC protocol → only `disable-copy`/
`disable-paste` are produced; no file-transfer/layout args):

```ts
params: toGuacArgs({}, site.clipboardMode, "VNC"),
```

`toGuacArgs` is already imported. `site.clipboardMode` is already selected (it's in
the `findUnique` select). No other descriptor change; `record` already returned.

### 2. Site form — `src/app/(app)/admin/sites/site-form.tsx`

Add a **Clipboard** select to the ISOLATED section (the `{accessMode === "ISOLATED" && …}`
block from A1), mirroring the gateway advanced block's clipboard control:

```tsx
<label className="field"><span className="field-label">Clipboard</span>
  <select className="select" value={clipboardMode} onChange={(e) => setClipboardMode(e.target.value)}>
    <option value="allow">Allow copy &amp; paste</option>
    <option value="no_copy">Block copy out (no exfil)</option>
    <option value="no_paste">Block paste in</option>
    <option value="none">Block both</option>
  </select>
  <span className="hint">Enforced by the session engine (guacd) — copy out of the isolated browser is disabled server-side, a real control.</span>
</label>
```

`clipboardMode` state already exists; the submit body already sends `clipboardMode`
for all modes; `validateSiteInput` (A1) already stores it for ISOLATED; the create/
update routes already persist it. So **only the UI control is added** — no route/
validate change.

## Deferred (documented non-goals)

- **Navigation-lock** (restrict where the isolated browser can go): a genuine gap,
  but per-session URL allow-listing via Chromium managed policy is system-wide in
  the shared broker container (per-session lists conflict). Kiosk mode already hides
  the address bar + blocks new tabs (partial mitigation). Needs per-container egress
  control or a different policy model — its own future slice. **Not in A3.**
- **Download-block:** downloads already land in the wiped `/profiles/<id>` and never
  reach the vendor's device — containment holds by design. **Not needed.**
- **Idle-kill tuning:** A2 already `/close`s on WS teardown + a 4h TTL reaper. **Leave as-is.**
- **Console labels / observability polish:** isolated sessions already appear in
  the live console via the shared session hub. **Not in A3.**

## Testing

- **Unit (`src/lib/gateway/guac-params.test.ts`):** add a VNC clipboard case —
  `toGuacArgs({}, "no_copy", "VNC")` → `{ "disable-copy": "true" }`;
  `toGuacArgs({}, "none", "VNC")` → `{ "disable-copy": "true", "disable-paste": "true" }`;
  `toGuacArgs({}, "allow", "VNC")` → `{}`. (Confirms the exact params the ISOLATED
  descriptor now emits.)
- `pnpm build` + `pnpm test` green.
- **Post-deploy (no browser):** POST the descriptor for an ISOLATED site whose
  `clipboardMode = no_copy` → the returned `params` include `"disable-copy":"true"`.
- **Gate A (operator):** on an ISOLATED site set Clipboard = **Block copy out** →
  in the session, selecting text in the isolated browser and copying does **not**
  land on the vendor's local clipboard. Set **Record sessions** on an ISOLATED site
  → a session produces a recording that plays back under `/admin/recordings`.

## Deploy

**v0.60.0**, manager only. Bump the manager tag, `docker compose up -d access-manager`,
verify `/login` 200 + `APP_VERSION`, then the descriptor check + Gate A, then an
English `gh release edit` note (isolated browser: block clipboard copy-out + session
recording).
