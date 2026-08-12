# Gateway File Transfer (E2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a vendor upload/download files in a remote-desktop session — RDP via a per-session guacd drive, SSH via SFTP — with Policy + per-resource enable / block-upload / block-download toggles, and a minimal drag-drop-upload + auto-download browser UI.

**Architecture:** Extends E1's `GuacParams`/`toGuacArgs` with three file-transfer booleans mapped protocol-aware; the data-plane injects a per-session `drive-path`; the connector deploy adds a writable drive volume and prunes old session dirs; the browser client gains `onfile`/`onfilesystem` handlers. No schema change (reuses `guacParams`).

**Tech Stack:** Next.js 16 / React 19, guacamole-common-js 1.5.0, Go (data-plane + connector), vitest + go test.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **No schema change** — reuses the `guacParams` JSON from E1.
- Protocol-aware mapping: RDP → `enable-drive`/`create-drive-path`/`drive-name`, SSH → `enable-sftp`, VNC → none; blocks → `disable-upload`/`disable-download` (RDP) or `sftp-disable-upload`/`sftp-disable-download` (SSH).
- `drive-path` is per-session (`/drive/<sessionID>`), injected in the data-plane only.
- Drive volume `captivo_guacd_drive` chowned to uid 1000 (like recordings/logs); connector prunes `/drive/*` dirs older than 12h, hourly.
- **Verify:** `pnpm build`; `pnpm test`; `cd dataplane && go test ./...`; `cd connector && go test ./...`.

---

### Task 1: File-transfer params + protocol-aware `toGuacArgs`

**Files:**
- Modify: `src/lib/gateway/guac-params.ts`, `src/lib/gateway/guac-params.test.ts`

**Interfaces:**
- Consumes: existing `GuacParams`, `parseGuacParams`, `resolveGuacParams`, `toGuacArgs` (E1).
- Produces: `GuacParams` with `enableFileTransfer`/`blockUpload`/`blockDownload`; `toGuacArgs(p, clipboardMode, protocol)`.

- [ ] **Step 1: Write the failing tests** — append to `guac-params.test.ts`, and update the two existing `toGuacArgs(...)` calls to pass a protocol:

```ts
// UPDATE the existing toGuacArgs tests to pass a protocol as the 3rd arg:
//   toGuacArgs({...}, "no_copy", "RDP")   and   toGuacArgs({}, "none", "RDP") / toGuacArgs({}, "allow", "RDP")

describe("toGuacArgs file transfer", () => {
  it("RDP on emits drive args; blocks map to disable-upload/download", () => {
    expect(toGuacArgs({ enableFileTransfer: true, blockUpload: true }, "allow", "RDP")).toEqual({
      "enable-drive": "true", "create-drive-path": "true", "drive-name": "Captivo", "disable-upload": "true",
    });
  });
  it("SSH on emits enable-sftp; blocks map to sftp-disable-*", () => {
    expect(toGuacArgs({ enableFileTransfer: true, blockDownload: true }, "allow", "SSH")).toEqual({
      "enable-sftp": "true", "sftp-disable-download": "true",
    });
  });
  it("VNC emits no file-transfer args", () => {
    expect(toGuacArgs({ enableFileTransfer: true, blockUpload: true }, "allow", "VNC")).toEqual({});
  });
  it("off emits nothing", () => {
    expect(toGuacArgs({ blockUpload: true }, "allow", "RDP")).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/gateway/guac-params.test.ts`
Expected: FAIL — new fields unknown; `toGuacArgs` takes 2 args.

- [ ] **Step 3: Implement in `guac-params.ts`**

Add the three fields to `GuacParams`:

```ts
  enableFullWindowDrag?: boolean;
  enableFileTransfer?: boolean;
  blockUpload?: boolean;
  blockDownload?: boolean;
```

Extend `BOOL_KEYS`:

```ts
const BOOL_KEYS = ["enableWallpaper", "enableTheming", "enableFontSmoothing", "enableFullWindowDrag", "enableFileTransfer", "blockUpload", "blockDownload"] as const;
```

Add the three to `resolveGuacParams`'s returned object:

```ts
    enableFileTransfer: resource.enableFileTransfer ?? policy.enableFileTransfer,
    blockUpload: resource.blockUpload ?? policy.blockUpload,
    blockDownload: resource.blockDownload ?? policy.blockDownload,
```

Change `toGuacArgs` to take `protocol` and map file transfer:

```ts
export function toGuacArgs(p: GuacParams, clipboardMode: string, protocol: "RDP" | "SSH" | "VNC"): Record<string, string> {
  const a: Record<string, string> = {};
  if (p.serverLayout) a["server-layout"] = p.serverLayout;
  if (p.colorDepth) a["color-depth"] = String(p.colorDepth);
  if (p.enableWallpaper) a["enable-wallpaper"] = "true";
  if (p.enableTheming) a["enable-theming"] = "true";
  if (p.enableFontSmoothing) a["enable-font-smoothing"] = "true";
  if (p.enableFullWindowDrag) a["enable-full-window-drag"] = "true";
  if (clipboardMode === "no_copy" || clipboardMode === "none") a["disable-copy"] = "true";
  if (clipboardMode === "no_paste" || clipboardMode === "none") a["disable-paste"] = "true";
  if (p.enableFileTransfer) {
    if (protocol === "RDP") {
      a["enable-drive"] = "true";
      a["create-drive-path"] = "true";
      a["drive-name"] = "Captivo";
      if (p.blockUpload) a["disable-upload"] = "true";
      if (p.blockDownload) a["disable-download"] = "true";
    } else if (protocol === "SSH") {
      a["enable-sftp"] = "true";
      if (p.blockUpload) a["sftp-disable-upload"] = "true";
      if (p.blockDownload) a["sftp-disable-download"] = "true";
    }
  }
  return a;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/gateway/guac-params.test.ts`
Expected: PASS (new + updated E1 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gateway/guac-params.ts src/lib/gateway/guac-params.test.ts
git commit -m "feat(gateway): file-transfer params + protocol-aware guac-arg mapping"
```

---

### Task 2: Descriptor protocol + per-session drive path

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`, `dataplane/guactunnel.go`, `dataplane/guacproto.go`
- Test: `dataplane/guacproto_test.go`

**Interfaces:**
- Consumes: `toGuacArgs(p, clipboardMode, protocol)` (Task 1); `GuacConn.Params` (E1).
- Produces: `injectDrivePath(params, sessionID)`.

- [ ] **Step 1: Pass the protocol in the descriptor route** — `descriptor/route.ts`

Change the `toGuacArgs` call to pass the protocol (upper-case enum):

```ts
  const params = toGuacArgs(resolved, site.clipboardMode, cred.protocol as "RDP" | "SSH" | "VNC");
```

- [ ] **Step 2: Write the failing Go test** — append to `dataplane/guacproto_test.go`

```go
func TestInjectDrivePath(t *testing.T) {
	p := map[string]string{"enable-drive": "true"}
	injectDrivePath(p, "sess123")
	if p["drive-path"] != "/drive/sess123" {
		t.Fatalf("drive-path not injected: %v", p)
	}
	q := map[string]string{}
	injectDrivePath(q, "sess123")
	if _, ok := q["drive-path"]; ok {
		t.Fatalf("drive-path set without enable-drive: %v", q)
	}
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd dataplane && go test ./... -run TestInjectDrivePath`
Expected: FAIL — `injectDrivePath` undefined.

- [ ] **Step 4: Implement `injectDrivePath`** — in `dataplane/guacproto.go` (near `buildConnect`)

```go
// injectDrivePath gives an RDP drive session-scoped isolation: a fresh
// /drive/<sessionID> that create-drive-path makes on connect. No-op unless the
// drive is enabled.
func injectDrivePath(params map[string]string, sessionID string) {
	if params != nil && params["enable-drive"] == "true" {
		params["drive-path"] = "/drive/" + sessionID
	}
}
```

- [ ] **Step 5: Call it in the handshake** — `dataplane/guactunnel.go`

Immediately before the `buildConnect(argNames, conn)` write, insert:

```go
	injectDrivePath(conn.Params, sessionID)
```

If `sessionID` is not yet in scope at that point (it is currently created for `hub.Register` after `ready`), hoist its creation above the handshake so it is available here and reuse the same value for `hub.Register`.

- [ ] **Step 6: Run tests + build**

Run: `cd dataplane && go test ./...` — Expected: PASS. Then `pnpm build` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/internal/gateway/descriptor/route.ts" dataplane/guactunnel.go dataplane/guacproto.go dataplane/guacproto_test.go
git commit -m "feat(gateway): per-session drive path + descriptor protocol for file transfer"
```

---

### Task 3: Drive volume + connector cleanup

**Files:**
- Modify: `src/lib/connector/repair.ts`, `src/lib/connector/repair.test.ts`, `connector/main.go`
- Create: `connector/drivecleanup.go`, `connector/drivecleanup_test.go`

**Interfaces:**
- Produces: `pruneDriveDir(root string, maxAge time.Duration, now time.Time)`, `startDriveCleanup(root string)`.

- [ ] **Step 1: Write the failing Go test** — `connector/drivecleanup_test.go`

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPruneDriveDir(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old")
	fresh := filepath.Join(root, "fresh")
	_ = os.Mkdir(old, 0o755)
	_ = os.Mkdir(fresh, 0o755)
	past := time.Now().Add(-24 * time.Hour)
	_ = os.Chtimes(old, past, past)

	pruneDriveDir(root, 12*time.Hour, time.Now())

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("old dir was not pruned")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("fresh dir was pruned")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd connector && go test ./... -run TestPruneDriveDir`
Expected: FAIL — `pruneDriveDir` undefined.

- [ ] **Step 3: Implement `connector/drivecleanup.go`**

```go
package main

import (
	"os"
	"path/filepath"
	"time"
)

// pruneDriveDir removes top-level dirs under root whose mtime is older than maxAge.
// Per-session RDP drive dirs (/drive/<sessionID>) accumulate; this bounds them.
func pruneDriveDir(root string, maxAge time.Duration, now time.Time) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > maxAge {
			_ = os.RemoveAll(filepath.Join(root, e.Name()))
		}
	}
}

// startDriveCleanup prunes old drive session dirs hourly. No-op when root is
// absent (i.e. not a gateway host with the drive volume mounted).
func startDriveCleanup(root string) {
	if _, err := os.Stat(root); err != nil {
		return
	}
	go func() {
		for {
			pruneDriveDir(root, 12*time.Hour, time.Now())
			time.Sleep(time.Hour)
		}
	}()
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd connector && go test ./... -run TestPruneDriveDir`
Expected: PASS.

- [ ] **Step 5: Wire it in `connector/main.go`**

Near the connector's startup (after flags/config are read, before the main dial loop), add:

```go
	startDriveCleanup("/drive")
```

- [ ] **Step 6: Add the drive volume to the deploy command** — `src/lib/connector/repair.ts`

- In the busybox chown step, add `/drive` to the mounts and the chown target:
  from `-v captivo_guacd_recordings:/rec -v captivo_guacd_logs:/log busybox chown -R 1000:1000 /rec /log`
  to `-v captivo_guacd_recordings:/rec -v captivo_guacd_logs:/log -v captivo_guacd_drive:/drive2 busybox chown -R 1000:1000 /rec /log /drive2`
  (mount at `/drive2` in the busybox step to avoid clashing with any host path; the target name only matters inside busybox).
- On the guacd `docker run`, add `-v captivo_guacd_drive:/drive` alongside the recordings/logs volumes.
- On the connector `docker run` (the `runCommand`'s connector line, gateway-host branch), add `-v captivo_guacd_drive:/drive:rw` (next to the existing `-v captivo_guacd_logs:/guaclog:ro`).

- [ ] **Step 7: Update `repair.test.ts` assertions**

In the gateway-host tests, assert the drive volume is present:

```ts
    expect(cmd).toContain("captivo_guacd_drive");
    expect(cmd).toContain("chown -R 1000:1000 /rec /log /drive2");
```

- [ ] **Step 8: Run tests**

Run: `cd connector && go test ./...` — Expected: PASS.
Run: `pnpm test src/lib/connector/repair.test.ts` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/connector/repair.ts src/lib/connector/repair.test.ts connector/drivecleanup.go connector/drivecleanup_test.go connector/main.go
git commit -m "feat(gateway): guacd drive volume + connector prune of old session dirs"
```

---

### Task 4: Browser upload/download UI

**Files:**
- Modify: `src/app/gateway/[siteId]/session/session-client.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `Guacamole.Client` `onfile`/`onfilesystem`, `Guacamole.BlobReader`/`BlobWriter`.

> No unit test (browser file transfer against guacd). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Add state + refs** — in `GatewaySession`, alongside the existing state

```tsx
  const guacRef = useRef<any>(null);
  const fsRef = useRef<any>(null);
  const [canUpload, setCanUpload] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
```

- [ ] **Step 2: Store the Guacamole module + add file hooks** — inside the effect, after `client.onerror = fail;`

```tsx
      guacRef.current = Guacamole;
      client.onfile = (stream: any, mimetype: string, filename: string) => {
        const reader = new Guacamole.BlobReader(stream, mimetype);
        reader.onend = () => {
          const url = URL.createObjectURL(reader.getBlob());
          const a = document.createElement("a");
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          if (!disposed) setToast(`Downloaded ${filename}`);
        };
      };
      client.onfilesystem = (object: any) => {
        fsRef.current = object;
        if (!disposed) setCanUpload(true);
      };
```

- [ ] **Step 3: Auto-hide the toast** — add a second effect

```tsx
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
```

- [ ] **Step 4: Add a drop handler** — a `useCallback` in the component

```tsx
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fs = fsRef.current, G = guacRef.current;
    if (!fs || !G || !e.dataTransfer?.files?.length) return;
    for (const file of Array.from(e.dataTransfer.files)) {
      const stream = fs.createOutputStream(file.type || "application/octet-stream", "/" + file.name);
      const writer = new G.BlobWriter(stream);
      setToast(`Uploading ${file.name}…`);
      writer.oncomplete = () => setToast(`Uploaded ${file.name}`);
      writer.onerror = () => setToast(`Upload failed: ${file.name}`);
      writer.sendBlob(file);
    }
  };
```

- [ ] **Step 5: Wire drop + overlays into the render** — on the outer container `<div>`, add `onDragOver={(e) => e.preventDefault()} onDrop={onDrop}`, and add the two overlays before the closing `</div>`:

```tsx
      {canUpload && <div className="ft-hint">Drop files to upload</div>}
      {toast && <div className="ft-toast">{toast}</div>}
```

- [ ] **Step 6: Styles** — append to `src/app/globals.css`

```css
/* Gateway file transfer */
.ft-hint { position: fixed; left: 12px; bottom: 12px; z-index: 20; pointer-events: none; background: rgba(0,0,0,0.6); color: #cdd7e6; font: 500 12px/1 sans-serif; padding: 6px 10px; border-radius: 6px; }
.ft-toast { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 21; pointer-events: none; background: rgba(0,0,0,0.8); color: #fff; font: 500 13px/1 sans-serif; padding: 8px 14px; border-radius: 8px; white-space: nowrap; }
```

- [ ] **Step 7: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/gateway/[siteId]/session/session-client.tsx" src/app/globals.css
git commit -m "feat(gateway): drag-drop upload + auto-download in remote-desktop sessions"
```

---

### Task 5: File-transfer toggles in the params UI

**Files:**
- Modify: `src/components/guac-params-fields.tsx`

**Interfaces:**
- Consumes: `GuacFields`, `GuacParams` (E1 + Task 1 fields).

> No unit test (form UI). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Extend the form shape** — in `guac-params-fields.tsx`

Add to `GuacFields` and `EMPTY_GUAC_FIELDS`: `fileTransfer`, `blockUpload`, `blockDownload` (all `string`, "" default).

```ts
export interface GuacFields {
  serverLayout: string; colorDepth: string;
  enableWallpaper: string; enableTheming: string; enableFontSmoothing: string; enableFullWindowDrag: string;
  fileTransfer: string; blockUpload: string; blockDownload: string;
}
export const EMPTY_GUAC_FIELDS: GuacFields = {
  serverLayout: "", colorDepth: "", enableWallpaper: "", enableTheming: "", enableFontSmoothing: "", enableFullWindowDrag: "",
  fileTransfer: "", blockUpload: "", blockDownload: "",
};
```

- [ ] **Step 2: Map the three tri-states** — in `paramsToGuacFields` and `guacFieldsToParams`

In `paramsToGuacFields` add:

```ts
    fileTransfer: tri(p.enableFileTransfer),
    blockUpload: tri(p.blockUpload),
    blockDownload: tri(p.blockDownload),
```

In `guacFieldsToParams`, after the existing toggle loop, add:

```ts
  const triToBool = (v: string, k: "enableFileTransfer" | "blockUpload" | "blockDownload") => {
    if (v === "on") (p as Record<string, unknown>)[k] = true;
    else if (v === "off") (p as Record<string, unknown>)[k] = false;
  };
  triToBool(f.fileTransfer, "enableFileTransfer");
  triToBool(f.blockUpload, "blockUpload");
  triToBool(f.blockDownload, "blockDownload");
```

- [ ] **Step 3: Render the File transfer group** — in `GuacParamsFields`

File transfer applies to RDP + SSH (not VNC). Compute `const showFt = !protocol || protocol === "RDP" || protocol === "SSH";` and, before the SSH early-return is reached, render it. Since SSH currently early-returns "No display parameters…", change that branch to still render the file-transfer group. Restructure so the file-transfer block renders whenever `showFt`, and the display fields render per the existing `showLayout`/`showDepth`/`showPerf` flags:

```tsx
  const showFt = !protocol || protocol === "RDP" || protocol === "SSH";
  const Tri = ({ label, k }: { label: string; k: keyof GuacFields }) => (
    <label className="field"><span className="field-label">{label}</span>
      <select className="select" value={value[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">Default</option><option value="on">On</option><option value="off">Off</option>
      </select>
    </label>
  );
  return (
    <div className="guac-fields">
      {showLayout && (/* keyboard layout select, unchanged */)}
      {showDepth && (/* colour depth select, unchanged */)}
      {showPerf && TOGGLES.map(/* unchanged */)}
      {showFt && <Tri label="File transfer" k="fileTransfer" />}
      {showFt && value.fileTransfer !== "off" && <Tri label="Block upload" k="blockUpload" />}
      {showFt && value.fileTransfer !== "off" && <Tri label="Block download" k="blockDownload" />}
    </div>
  );
```

Remove the old `if (protocol === "SSH") return <p>…</p>;` early-return (SSH now shows the file-transfer group). If SSH ends up with only the file-transfer group, that is correct.

- [ ] **Step 4: Verify build + full tests**

Run: `pnpm build` — Expected: PASS. `pnpm test` — Expected: all pass. `cd dataplane && go test ./...` and `cd connector && go test ./...` — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/guac-params-fields.tsx
git commit -m "feat(gateway): file-transfer toggles in policy + resource params UI"
```

- [ ] **Step 6: Gate A — live validation (operator, after deploy)**

After deploy (bump manager + data-plane + connector; gateway hosts **re-run the connector Update command** to get the drive volume + cleanup):
1. On an RDP resource, set **File transfer = On**; open a session; drag a file onto it → it appears on the remote drive (a "Captivo" drive in *This PC*); copy a file into the session's **Download** folder → it downloads in the browser.
2. Set **Block upload** / **Block download** → each is enforced.
3. Two concurrent sessions of the same resource don't see each other's files (per-session drive).
4. On an SSH resource with File transfer On, SFTP upload/download works.
5. A VNC resource shows no file-transfer options.

---

## Self-Review

**1. Spec coverage:**
- `GuacParams` + three booleans, `toGuacArgs(p, clipboardMode, protocol)` protocol-aware → Task 1. ✓
- Descriptor passes protocol; data-plane injects `/drive/<sessionID>` → Task 2. ✓
- Drive volume + chown + connector `:rw` mount + prune goroutine (12h/hourly) → Task 3. ✓
- Browser `onfile` download + drag-drop upload + toast/hint → Task 4. ✓
- File-transfer toggles UI (RDP+SSH, not VNC), tri-state mapping → Task 5. ✓
- No schema change (reuses `guacParams`), server-enforced blocks, VNC excluded → across tasks. ✓
- Testing (toGuacArgs mapping, drive-path injection, prune, Gate A) → Task 1/2/3/5. ✓
- Deploy (manager + data-plane + connector; re-run connector Update) → Global Constraints + Task 5 Gate A. ✓

**2. Placeholder scan:** No TBD/TODO. The two browser/UI tasks state the no-unit-test justification. Task 5 Step 3 references "unchanged" for the three E1 field blocks — that is repetition-avoidance of code already present in the file being edited (not a new definition), and the surrounding structure is given in full.

**3. Type consistency:**
- `GuacParams.enableFileTransfer/blockUpload/blockDownload` (Task 1) are read by `toGuacArgs` (Task 1), `resolveGuacParams` (Task 1), and mapped in `guacFieldsToParams`/`paramsToGuacFields` (Task 5). ✓
- `toGuacArgs(p, clipboardMode, protocol)` (Task 1) matches the descriptor call site update (Task 2). ✓
- `injectDrivePath(params, sessionID)` (Task 2) matches its guactunnel call + test. ✓
- guacd arg names (`enable-drive`, `create-drive-path`, `drive-name`, `enable-sftp`, `disable-upload`, `disable-download`, `sftp-disable-upload`, `sftp-disable-download`, `drive-path`) are the exact strings guacd lists and `buildConnect` matches by name. ✓
- `GuacFields` new keys (`fileTransfer`/`blockUpload`/`blockDownload`) match the render + converters (Task 5). ✓
- `captivo_guacd_drive` volume name is consistent across the chown, guacd mount, connector mount, and the `/drive` path the connector prunes + the data-plane's `/drive/<sessionID>`. ✓
