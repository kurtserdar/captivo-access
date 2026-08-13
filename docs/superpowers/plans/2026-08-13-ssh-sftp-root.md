# SSH SFTP Upload Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix SSH gateway file uploads ("Unable to write to file") by rooting guacd's SFTP at a writable directory — the SSH user's home by default, with an optional per-resource override.

**Architecture:** `toGuacArgs` emits `sftp-root-directory` in the SSH file-transfer branch, using an explicit per-resource override (stored in the existing `VaultCredential.guacParams` JSON) or, when unset, the login user's home derived from the username. The descriptor route passes the username; the site form gains an SSH-only text field. No schema, no guacd/dataplane change.

**Tech Stack:** TypeScript, Next.js (App Router), React, vitest.

## Global Constraints

- **English only** — code, comments, commit messages. **No Claude signature.**
- **Manager-only**, **no schema** (override rides in `VaultCredential.guacParams` JSON), no guacd/dataplane/connector change. Ships as **v0.57.0**.
- `sftp-root-directory` must be an **absolute** path (guacd rejects relative roots). Emit it **only** in the SSH branch when `enableFileTransfer` is true. Never for RDP/VNC.
- Override precedence: explicit `sftpRoot` (trimmed, truthy — including `/`) wins; else derived home (`root` → `/root`, else `/home/<username>`, else `/`).
- Don't change the client's leading `/`; don't set `sftp-directory`.
- Verify with `pnpm test` and `pnpm build` (no `grep` pipe — capture the exit code).

---

### Task 1: `guac-params.ts` — sftpRoot param, validation, derived-home arg

**Files:**
- Modify: `src/lib/gateway/guac-params.ts`
- Test: `src/lib/gateway/guac-params.test.ts`

**Interfaces:**
- Produces: `GuacParams.sftpRoot?: string`; `sshHome(username?: string): string`; `toGuacArgs(p: GuacParams, clipboardMode: string, protocol: "RDP"|"SSH"|"VNC", username?: string): Record<string,string>` (new 4th arg).
- Consumes: existing `parseGuacParams`, `resolveGuacParams`.

- [ ] **Step 1: Add the failing tests**

In `src/lib/gateway/guac-params.test.ts`, add to the `parseGuacParams` describe block:

```ts
  it("keeps a valid absolute sftpRoot (hyphens/spaces ok), drops relative / control-char / over-long", () => {
    expect(parseGuacParams({ sftpRoot: "/srv/my-incoming dir" })).toEqual({ sftpRoot: "/srv/my-incoming dir" });
    expect(parseGuacParams({ sftpRoot: "relative/path" })).toEqual({});
    expect(parseGuacParams({ sftpRoot: "/bad\tnull" })).toEqual({});
    expect(parseGuacParams({ sftpRoot: "/" + "a".repeat(1100) })).toEqual({});
  });
```

Add to the `toGuacArgs file transfer` describe block:

```ts
  it("SSH derives sftp-root-directory from the username's home", () => {
    expect(toGuacArgs({ enableFileTransfer: true }, "allow", "SSH", "deploy")).toEqual({
      "enable-sftp": "true", "sftp-root-directory": "/home/deploy",
    });
  });
  it("SSH root user maps to /root", () => {
    expect(toGuacArgs({ enableFileTransfer: true }, "allow", "SSH", "root")).toEqual({
      "enable-sftp": "true", "sftp-root-directory": "/root",
    });
  });
  it("SSH with no username falls back to /", () => {
    expect(toGuacArgs({ enableFileTransfer: true }, "allow", "SSH")).toEqual({
      "enable-sftp": "true", "sftp-root-directory": "/",
    });
  });
  it("SSH explicit sftpRoot override wins (including /)", () => {
    expect(toGuacArgs({ enableFileTransfer: true, sftpRoot: "/data/up" }, "allow", "SSH", "deploy")).toEqual({
      "enable-sftp": "true", "sftp-root-directory": "/data/up",
    });
    expect(toGuacArgs({ enableFileTransfer: true, sftpRoot: "/" }, "allow", "SSH", "deploy")).toEqual({
      "enable-sftp": "true", "sftp-root-directory": "/",
    });
  });
  it("SSH file transfer off emits no sftp args", () => {
    expect(toGuacArgs({ sftpRoot: "/data" }, "allow", "SSH", "deploy")).toEqual({});
  });
  it("RDP/VNC never emit sftp-root-directory", () => {
    expect(toGuacArgs({ enableFileTransfer: true, sftpRoot: "/data" }, "allow", "RDP", "deploy"))
      .not.toHaveProperty("sftp-root-directory");
    expect(toGuacArgs({ enableFileTransfer: true, sftpRoot: "/data" }, "allow", "VNC", "deploy")).toEqual({});
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/gateway/guac-params.test.ts`
Expected: FAIL — `sftpRoot` not parsed; `toGuacArgs` has no 4th arg and emits no `sftp-root-directory`.

- [ ] **Step 3: Add the `sftpRoot` field + validation**

In `src/lib/gateway/guac-params.ts`, add `sftpRoot` to the interface (after `blockDownload`):

```ts
  blockDownload?: boolean;
  sftpRoot?: string;
```

In `parseGuacParams`, before `return out;`, add:

```ts
  if (typeof o.sftpRoot === "string") {
    const v = o.sftpRoot.trim();
    // Absolute path only (guacd rejects relative SFTP roots), bounded, no control chars.
    if (v.startsWith("/") && v.length <= 1024 && !/[\x00-\x1f]/.test(v)) out.sftpRoot = v;
  }
```

- [ ] **Step 4: Pass sftpRoot through `resolveGuacParams`**

In `resolveGuacParams`, add to the returned object (after `blockDownload`):

```ts
    blockDownload: resource.blockDownload ?? policy.blockDownload,
    sftpRoot: resource.sftpRoot ?? policy.sftpRoot,
```

- [ ] **Step 5: Add `sshHome` + emit `sftp-root-directory`**

In `src/lib/gateway/guac-params.ts`, add the helper above `toGuacArgs`:

```ts
// The writable SFTP root for an SSH target: the login user's home. guacd defaults
// sftp-root-directory to "/", which non-root users can't write to → "Unable to
// write to file". Absolute path required (guacd rejects relative roots).
export function sshHome(username?: string): string {
  if (username === "root") return "/root";
  if (username && username.length > 0) return "/home/" + username;
  return "/";
}
```

Change the `toGuacArgs` signature to accept `username`:

```ts
export function toGuacArgs(p: GuacParams, clipboardMode: string, protocol: "RDP" | "SSH" | "VNC", username?: string): Record<string, string> {
```

In the SSH file-transfer branch, after `a["enable-sftp"] = "true";`, add the root:

```ts
    } else if (protocol === "SSH") {
      a["enable-sftp"] = "true";
      a["sftp-root-directory"] = (p.sftpRoot && p.sftpRoot.trim()) || sshHome(username);
      if (p.blockUpload) a["sftp-disable-upload"] = "true";
      if (p.blockDownload) a["sftp-disable-download"] = "true";
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/lib/gateway/guac-params.test.ts`
Expected: PASS (existing + new cases). The existing `"SSH on emits enable-sftp"` test calls `toGuacArgs(…, "SSH")` with no username → it now also emits `"sftp-root-directory": "/"`. **Update that existing assertion** to include it:

```ts
  it("SSH on emits enable-sftp; blocks map to sftp-disable-*", () => {
    expect(toGuacArgs({ enableFileTransfer: true, blockDownload: true }, "allow", "SSH")).toEqual({
      "enable-sftp": "true", "sftp-root-directory": "/", "sftp-disable-download": "true",
    });
  });
```

Re-run: `pnpm test src/lib/gateway/guac-params.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/gateway/guac-params.ts src/lib/gateway/guac-params.test.ts
git commit -m "fix(gateway): root SSH SFTP at the user's home (+ optional override) so uploads write"
```

---

### Task 2: descriptor route passes the username

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`

**Interfaces:**
- Consumes: `toGuacArgs(…, username?)` (Task 1); `cred.username`.

- [ ] **Step 1: Thread the username in**

In `src/app/api/internal/gateway/descriptor/route.ts`, change the `toGuacArgs` call:

```ts
  const params = toGuacArgs(resolved, site.clipboardMode, cred.protocol as "RDP" | "SSH" | "VNC");
```

to:

```ts
  const params = toGuacArgs(resolved, site.clipboardMode, cred.protocol as "RDP" | "SSH" | "VNC", cred.username);
```

- [ ] **Step 2: Verify build**

Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?`
Expected: `EXIT=0`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/internal/gateway/descriptor/route.ts"
git commit -m "fix(gateway): pass SSH username into guac args for the SFTP root"
```

---

### Task 3: site-form SSH-only "SFTP upload folder" field

**Files:**
- Modify: `src/components/guac-params-fields.tsx`

**Interfaces:**
- Consumes: `GuacParams.sftpRoot` (Task 1).
- Produces: `GuacFields.sftpRoot: string`; the round-trip through `paramsToGuacFields` / `guacFieldsToParams`.

- [ ] **Step 1: Add `sftpRoot` to the form shape + converters**

In `src/components/guac-params-fields.tsx`:

Add to the `GuacFields` interface (after `blockDownload: string;`):

```ts
  blockDownload: string;
  sftpRoot: string;
```

Add to `EMPTY_GUAC_FIELDS`:

```ts
  fileTransfer: "", blockUpload: "", blockDownload: "", sftpRoot: "",
```

In `paramsToGuacFields`, add to the returned object:

```ts
    blockDownload: tri(p.blockDownload),
    sftpRoot: p.sftpRoot ?? "",
```

In `guacFieldsToParams`, before `return p;`:

```ts
  if (f.sftpRoot.trim()) p.sftpRoot = f.sftpRoot.trim();
```

- [ ] **Step 2: Render the SSH-only field**

In `GuacParamsFields`, add a visibility flag next to the others:

```ts
  const showFt = !protocol || protocol === "RDP" || protocol === "SSH";
  const showSftpRoot = !protocol || protocol === "SSH";
```

After the "Block download" `{showFt && …}` block (before the closing `</div>`), add:

```tsx
      {showSftpRoot && value.fileTransfer !== "off" && (
        <label className="field"><span className="field-label">SFTP upload folder {protocol ? "" : "(SSH)"}</span>
          <input className="input" type="text" value={value.sftpRoot} placeholder="Auto (the user's home directory)"
            onChange={(e) => set("sftpRoot", e.target.value)} />
          <span className="field-hint">Absolute path on the target where uploaded files are written. Leave blank to use the login user&apos;s home.</span>
        </label>
      )}
```

- [ ] **Step 3: Verify build**

Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?`
Expected: `EXIT=0`. (Confirm `.field-hint` styling exists; if the class is unknown it still renders as plain text — acceptable. Other fields in this repo use `field-hint` for helper copy.)

- [ ] **Step 4: Commit**

```bash
git add src/components/guac-params-fields.tsx
git commit -m "feat(gateway): SSH-only SFTP upload-folder override in the resource form"
```

---

### Task 4: Whole-feature verification

**Files:** none.

- [ ] **Step 1: Suite** — Run: `pnpm test > /tmp/t.log 2>&1; echo EXIT=$?` → `EXIT=0`.
- [ ] **Step 2: Build** — Run: `pnpm build > /tmp/b.log 2>&1; echo EXIT=$?` → `EXIT=0`.
- [ ] **Step 3: Post-deploy descriptor check (no browser needed).** After deploy, for a real SSH gateway site with file transfer enabled, POST the descriptor and confirm `sftp-root-directory` is now present:

```bash
SECRET=$(docker exec cap-access-manager sh -c 'printf %s "$DATAPLANE_SECRET"')
curl -fsS -X POST -H "x-dataplane-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"userId":"<vendor-user-id>","siteId":"<ssh-site-id>"}' \
  http://127.0.0.1:3100/api/internal/gateway/descriptor | python3 -m json.tool | grep -A1 sftp-root
```
Expected: `"sftp-root-directory": "/home/<user>"` (or the override).

- [ ] **Step 4: Gate A (manual):** open an SSH gateway session with file transfer on → drag a file to upload → succeeds, file lands in the home dir (or the configured folder); download still works; set an explicit "SFTP upload folder" and confirm uploads write there.

---

## Notes for the implementer

- `sftp-root-directory` is emitted **only** inside the SSH `enableFileTransfer` branch — never for RDP (drive) or VNC.
- The derived `/home/<username>` is best-effort; a wrong guess fails exactly as today (no new failure mode) and the override is the fix for non-standard homes.
- No schema migration — the override is a key inside the existing `VaultCredential.guacParams` JSON, validated by `parseGuacParams`.
- Deploy: **v0.57.0, manager-only** — bump the manager tag, `docker compose pull access-manager` + `up -d access-manager`, verify `/login` 200 (`-H "Host: manager.access.captivo.io"` on `127.0.0.1:3100`) + `docker exec cap-access-manager sh -c 'echo $APP_VERSION'`, then the descriptor check + Gate A, then `gh release edit v0.57.0` with an English note: SSH gateway file uploads now work (saved to the user's home by default; optional per-resource folder).
```
