# Isolated Watermark DLP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay an identifying watermark (vendor email + live UTC clock) on isolated browser sessions, configurable as a global default with a per-site override.

**Architecture:** `Site.watermark` (nullable, inherit) resolves against a global `PlatformSettings.watermarkDefault`; the descriptor builds the strftime watermark text; the data-plane threads it to the broker, which passes KasmVNC `DLP_Watermark*` flags to Xvnc (the B2 clipboard pattern — Xvnc launched directly). Fixed appearance; recordings + admin view show it too.

**Tech Stack:** Prisma (db push), Next.js/TypeScript, Go data-plane, Python broker, KasmVNC.

## Global Constraints

- English-only console strings, commits, and code comments. Proper Turkish only in chat.
- No Claude signature in commits or PRs.
- Backward compatible: no/empty watermark text → no DLP flags (today's behaviour).
- Watermark applies to ISOLATED only. Do not touch GATEWAY, clipboard DLP, recording, sizing, live watching.
- Schema additions are additive (nullable) → `prisma db push` without `--accept-data-loss`.
- Deploy + release note are a separate gate needing explicit user approval.
- Subagent quota full — inline execution.

---

### Task 1: Spike — watermark renders with a live clock

**Files:** none (throwaway container run).

- [ ] **Step 1: Start a display with the watermark flags, capture a frame**

Run (renders a solid bg + watermark, grabs one frame, checks it produced output):
```bash
docker run --rm --entrypoint sh ghcr.io/kurtserdar/captivo-access-kasm-browser:0.70.0 -c '
Xvnc :91 -geometry 1280x800 -depth 24 -SecurityTypes None -disableBasicAuth \
  "-DLP_WatermarkText=vendor@example.com  %Y-%m-%d %H:%M UTC" \
  -DLP_WatermarkTextAngle=30 -DLP_WatermarkRepeatSpace=380 -DLP_WatermarkFontSize=28 \
  -DLP_WatermarkTint=255,255,255,45 >/tmp/x.log 2>&1 &
sleep 3;
DISPLAY=:91 hsetroot -solid "#202830" 2>/dev/null;
sleep 1;
ffmpeg -loglevel error -f x11grab -video_size 1280x800 -i :91 -frames:v 1 -y /tmp/wm.png 2>&1 | tail -3;
ls -l /tmp/wm.png; tail -3 /tmp/x.log'
```
Expected: `/tmp/wm.png` is produced (non-zero) and `x.log` shows no fatal error — i.e. Xvnc accepts the `DLP_Watermark*` flags. If Xvnc rejects a flag, note the correction (e.g. flag name/format) for Task 6. Visual tiling/opacity is tuned by adjusting `RepeatSpace`/`Tint` alpha; record the chosen values. No commit.

---

### Task 2: Schema — `Site.watermark` + `PlatformSettings.watermarkDefault`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the columns**

In `prisma/schema.prisma`, add to `model Site` (near `recordSessions`/`clipboardMode`):

```prisma
  watermark          Boolean?      // null = inherit the global watermark default
```

Add to `model PlatformSettings` (near `recordingConsentRequired`):

```prisma
  watermarkDefault         Boolean? // global watermark default; null = env/default → false
```

- [ ] **Step 2: Regenerate the client**

Run: `pnpm db:generate`
Expected: success (Prisma client regenerated). The `db push` runs at deploy.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add Site.watermark + PlatformSettings.watermarkDefault"
```

---

### Task 3: Platform resolver — `resolvedWatermarkDefault`

**Files:**
- Modify: `src/lib/settings/platform.ts`

**Interfaces:**
- Produces: `PlatformSettings.watermarkDefault`; `resolvedWatermarkDefault(): Promise<boolean>`.

- [ ] **Step 1: Add to the interface + EMPTY + loader**

In `src/lib/settings/platform.ts`: add `watermarkDefault: boolean | null;` to the `PlatformSettings` interface; add `watermarkDefault: null,` to the `EMPTY` object; add `watermarkDefault: c?.watermarkDefault ?? null,` to the `s` object built in `getPlatformSettings`.

- [ ] **Step 2: Add the resolver**

Add next to `resolvedRecordingConsentRequired`:

```ts
// Screen watermark default: DB value first, else the WATERMARK_DEFAULT env
// (1/true/on/yes), else false.
export async function resolvedWatermarkDefault(): Promise<boolean> {
  const s = await getPlatformSettings();
  if (s.watermarkDefault !== null) return s.watermarkDefault;
  const v = process.env.WATERMARK_DEFAULT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add src/lib/settings/platform.ts
git commit -m "feat(settings): watermarkDefault platform setting + resolver"
```

---

### Task 4: Descriptor — resolve watermark + build text

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`

- [ ] **Step 1: Select watermark + resolve + build text (ISOLATED branch)**

In `src/app/api/internal/gateway/descriptor/route.ts`:

Add `watermark: true` to the site `select`, and import the resolver:

```ts
import { resolvedWatermarkDefault } from "@/lib/settings/platform";
```

In the `if (site.accessMode === "ISOLATED")` block, before the `return`, resolve the flag and build the text:

```ts
    const watermarkOn = site.watermark ?? (await resolvedWatermarkDefault());
    let watermarkText = "";
    if (watermarkOn) {
      const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
      const who = u?.email ?? "";
      if (who) watermarkText = who + "  %Y-%m-%d %H:%M UTC";
    }
```

Add `watermarkText,` to the returned kasm descriptor JSON object.

- [ ] **Step 2: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/api/internal/gateway/descriptor/route.ts"
git commit -m "feat(descriptor): resolve isolated watermark + build strftime text"
```

---

### Task 5: Data-plane — thread `watermarkText`

**Files:**
- Modify: `dataplane/kasmtunnel.go`

**Interfaces:**
- Produces: `openKasmSession(..., watermarkText string)`.

- [ ] **Step 1: Add the field to `kasmDesc`**

In `dataplane/kasmtunnel.go`, add to the `kasmDesc` struct (after `Record`):

```go
	WatermarkText   string `json:"watermarkText"`
```

- [ ] **Step 2: `openKasmSession` sends it**

Change the signature and body:

```go
func openKasmSession(rw io.ReadWriter, host, target string, copyOut, pasteIn bool, w, h int, watermarkText string) (id string, port, status int, err error) {
	body := `{"url":` + jsonQuoteKasm(target) +
		`,"copyOut":` + strconv.FormatBool(copyOut) +
		`,"pasteIn":` + strconv.FormatBool(pasteIn) +
		`,"w":` + strconv.Itoa(w) +
		`,"h":` + strconv.Itoa(h) +
		`,"watermarkText":` + jsonQuoteKasm(watermarkText) + `}`
```

- [ ] **Step 3: Pass it at the call site**

At the call site (`openKasmSession(st, d.KasmControlAddr, d.NavigateUrl, co, pi, cw, ch)`), append `d.WatermarkText`:

```go
			id, port, status, e = openKasmSession(st, d.KasmControlAddr, d.NavigateUrl, co, pi, cw, ch, d.WatermarkText)
```

- [ ] **Step 4: Fix the test signature**

In `dataplane/kasmtunnel_test.go`, both `openKasmSession(...)` calls now need a trailing `""` argument. Add `, ""` before the closing paren of each.

- [ ] **Step 5: Build + test + commit**

Run: `cd dataplane && go build ./... && go test ./...`
Expected: PASS.

```bash
git add dataplane/kasmtunnel.go dataplane/kasmtunnel_test.go
git commit -m "feat(dataplane): thread watermark text to the isolated broker"
```

---

### Task 6: Broker — pass the DLP watermark flags

**Files:**
- Modify: `kasm-browser/control.py`

- [ ] **Step 1: `_spawn` appends the flags when text is set**

In `_spawn`, add a `watermark_text=""` parameter and, when non-empty, extra Xvnc args. Change the signature:

```python
def _spawn(display, url, profile, home, copy_out, paste_in, w=1280, h=800, watermark_text=""):
```

Build the Xvnc arg list so the watermark flags are appended only when text is set. Replace the single `xvnc = subprocess.Popen([...], env=env)` with:

```python
    xvnc_args = ["Xvnc", disp, "-geometry", "%dx%d" % (w, h), "-depth", "24",
                 "-websocketPort", str(port), "-interface", "0.0.0.0",
                 "-httpd", "/usr/share/kasmvnc/www", "-SecurityTypes", "None",
                 "-disableBasicAuth", "-AlwaysShared=1", send_cut, accept_cut]
    if watermark_text:
        # DLP watermark rendered server-side onto the framebuffer (appears in the
        # vendor view, the recording, and any screenshot). strftime in the text gives
        # a live clock. Fixed tiled/diagonal/translucent appearance.
        wt = watermark_text[:200]
        xvnc_args += ["-DLP_WatermarkText=" + wt, "-DLP_WatermarkTextAngle=30",
                      "-DLP_WatermarkRepeatSpace=380", "-DLP_WatermarkFontSize=28",
                      "-DLP_WatermarkTint=255,255,255,45"]
    xvnc = subprocess.Popen(xvnc_args, env=env)
```

(Use the exact flag names/values confirmed in Task 1.)

- [ ] **Step 2: Thread w/h/text through `open_session` + `POST /session`**

`open_session` signature:

```python
def open_session(url, copy_out, paste_in, w=1280, h=800, watermark_text=""):
```

Pass it to `_spawn`:

```python
        procs = _spawn(display, url, profile, home, copy_out, paste_in, w, h, watermark_text)
```

In the `POST /session` handler, read it and pass it:

```python
            wtext = data.get("watermarkText", "")
            if not isinstance(wtext, str):
                wtext = ""
            res = open_session(url, copy_out, paste_in, w, h, wtext)
```

- [ ] **Step 3: Verify + commit**

Run: `python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('ok')"`
Expected: `ok`

```bash
git add kasm-browser/control.py
git commit -m "feat(isolated): apply DLP watermark flags when watermark text is set"
```

---

### Task 7: Policy UI — global watermark default toggle

**Files:**
- Modify: `src/app/(app)/admin/policy/platform-settings-form.tsx`
- Modify: the platform-settings save route (wherever `recordingConsentRequired` is persisted)
- Modify: `src/app/(app)/admin/policy/page.tsx` (pass the initial value)

- [ ] **Step 1: Add the toggle + save field**

In `platform-settings-form.tsx`: add a state `const [watermark, setWatermark] = useState(initial.watermarkDefault === true);` (mirroring `anchorOn`/`consent`); add `watermarkDefault: watermark,` to the save body object; add a "Screen watermark" setting row with a `<label className="switch"><input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /><span className="track" /></label>`, hint: "Overlay each isolated browser session with the vendor's email + a live clock (shown on screen, in recordings, and on screenshots). Per-site setting can override this."

- [ ] **Step 2: Persist it**

In the platform-settings save route, add `watermarkDefault` to the accepted+written fields alongside `recordingConsentRequired` (same boolean handling). In `page.tsx`, include `watermarkDefault` in the `initial` passed to the form (from `getPlatformSettings()`).

- [ ] **Step 3: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add "src/app/(app)/admin/policy/platform-settings-form.tsx" "src/app/(app)/admin/policy/page.tsx" <save-route>
git commit -m "feat(policy): global screen-watermark default toggle"
```

---

### Task 8: Site form — per-site watermark override

**Files:**
- Modify: `src/lib/site/validate.ts`
- Modify: `src/app/(app)/admin/sites/site-form.tsx`
- Modify: `src/app/api/admin/sites/route.ts` (create) + the sites update route
- Modify: `src/app/(app)/admin/sites/[id]/edit/page.tsx`

- [ ] **Step 1: validate.ts — parse the tri-state**

In `src/lib/site/validate.ts`, add `watermark: boolean | null;` to the ISOLATED variant type, and in the ISOLATED parse return add:

```ts
      watermark: body.watermark === true ? true : body.watermark === false ? false : null,
```

- [ ] **Step 2: site-form.tsx — Inherit/On/Off select**

Add `watermark?: boolean | null;` to `SiteInitial`. Add state:

```tsx
  const [watermark, setWatermark] = useState<"inherit" | "on" | "off">(
    site?.watermark == null ? "inherit" : site.watermark ? "on" : "off",
  );
```

In the ISOLATED section (near the clipboard select), add a select:

```tsx
            <select id="site-watermark" className="select" value={watermark} onChange={(e) => setWatermark(e.target.value as "inherit" | "on" | "off")}>
              <option value="inherit">Watermark: use global default</option>
              <option value="on">Watermark: on</option>
              <option value="off">Watermark: off</option>
            </select>
```

In the submit body, add:

```tsx
          watermark: watermark === "inherit" ? null : watermark === "on",
```

- [ ] **Step 3: routes — write the field**

In `src/app/api/admin/sites/route.ts`, the ISOLATED create `data` object (line ~62) add `watermark: v.watermark,`. Do the same in the sites update route's ISOLATED update data.

- [ ] **Step 4: edit page — pass the initial**

In `src/app/(app)/admin/sites/[id]/edit/page.tsx`, add `watermark` to the site select and to the `SiteForm` `site` prop.

- [ ] **Step 5: Build + commit**

Run: `pnpm build`
Expected: success.

```bash
git add src/lib/site/validate.ts "src/app/(app)/admin/sites/site-form.tsx" "src/app/api/admin/sites/route.ts" <update-route> "src/app/(app)/admin/sites/[id]/edit/page.tsx"
git commit -m "feat(sites): per-site watermark override (inherit/on/off)"
```

---

### Task 9: Full verification

**Files:** none.

- [ ] **Step 1: All builds green**

Run: `pnpm build && cd dataplane && go build ./... && go test ./... && cd .. && python3 -c "import ast; ast.parse(open('kasm-browser/control.py').read()); print('py ok')"`
Expected: all PASS.

- [ ] **Step 2: Wiring grep**

Run: `grep -rn "watermarkText" src/app/api/internal/gateway/descriptor/route.ts dataplane/kasmtunnel.go && grep -rn "resolvedWatermarkDefault\|watermarkDefault" src/lib/settings/platform.ts && grep -rn "DLP_WatermarkText" kasm-browser/control.py`
Expected: matches in each.

- [ ] **Step 3: Manual Gate (record for deploy gate)**

Deferred to deploy (`db push` for the two columns; gateway host pulls the new kasm image):
- Turn on the global default (or a site override) → an isolated session shows a tiled/diagonal/translucent watermark with the vendor's email + live UTC clock; the recording shows it; live admin view shows it.
- Turn it off (site off, or global off + site inherit) → clean screen.
- Clipboard DLP, sizing, recording seek, GATEWAY unchanged.

---

## Self-Review

**Spec coverage:**
- Schema `Site.watermark` + `PlatformSettings.watermarkDefault` (additive) → Task 2. ✓
- `resolvedWatermarkDefault` (DB→env→false) → Task 3. ✓
- Descriptor resolves `site.watermark ?? global`, builds `<email>  %Y-%m-%d %H:%M UTC` → Task 4. ✓
- Data-plane `kasmDesc.WatermarkText` + `openKasmSession` + test fix → Task 5. ✓
- Broker DLP_Watermark* flags when text set (fixed appearance, bounded length) → Task 6 (validated by Task 1 spike). ✓
- Global toggle (policy) + per-site Inherit/On/Off (site form) → Tasks 7–8. ✓
- Watermark-only (no region); backward-compatible empty→off → per spec. ✓

**Placeholder scan:** enforcement path (2–6) fully concrete. UI tasks (7–8) name the exact fields/values and mirror the existing `recordingConsentRequired`/`recordSessions` handling; the `<save-route>`/update-route paths are resolved by reading the file during execution (they persist the same sibling fields).

**Type/name consistency:** `watermark` is `Boolean?` (schema) / `boolean | null` (validate, site-form) / tri-state select mapping null↔"inherit". `watermarkDefault` boolean|null across schema/platform/policy. `watermarkText` string across descriptor JSON, `kasmDesc.WatermarkText`, `openKasmSession` param, broker `watermarkText`/`watermark_text`. `openKasmSession(..., watermarkText string)` defined + called + tested consistently.
