# Gateway v2 — Slice B (bundled guacd + retire web-app pack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gateway-host connector deploys guacd in the same one-command install; the old Guacamole web-app pack and json-auth path are removed.

**Architecture:** Extend the connector command builder so `gatewayHost` prepends idempotent guacd provisioning (network + recordings volume + `captivo-guacd`). Point the manager's `GUACD_ADDR` default at `captivo-guacd:4822`, repoint the last json-auth references, then delete the dead pack + json-auth code. Manager + connector-command only.

**Tech Stack:** Next.js, Go (unchanged), `guacamole/guacd:1.5.5`, Vitest.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **guacd is bundled into the connector command** when `gatewayHost` — one shell command installs connector + guacd, idempotently.
- **guacd name = `captivo-guacd`**, on the `captivo-gateway` network (`GATEWAY_NETWORK` in `repair.ts`); recordings volume `captivo_guacd_recordings` mounted at `/recordings`, chowned to uid 1000 (guacd's user).
- **`GUACD_ADDR` default → `captivo-guacd:4822`** (env override still wins).
- **Native is the only gateway** — remove the json-auth launch route, `guac-json.ts`, the `deploy/gateway/` pack, `src/lib/gateway/assets.ts` + its serving routes, and the gateway-guide button. After removal, `grep -rn "guac-json\|GATEWAY_COMPOSE\|json-auth\|gateway/launch\|GUAC_JSON_SECRET_KEY" src/` returns nothing.
- **Manager only** — the data-plane and connector Go images are unchanged (the connector already has the guacd relay).

---

## File Structure

- `src/lib/connector/repair.ts` — `runCommand` prepends guacd provisioning when `gatewayHost`.
- `src/lib/connector/repair.test.ts` — extend with guacd assertions.
- `src/app/api/internal/gateway/descriptor/route.ts` — `GUACD_ADDR` default → `captivo-guacd:4822`.
- `src/app/gateway/[siteId]/session/page.tsx` — replace the launch fallback with `notFound()`.
- `src/app/(app)/access/access-view.tsx` — GATEWAY Open always → the native session page.
- Removals: `src/app/api/access/gateway/[siteId]/launch/route.ts`, `src/lib/vault/guac-json.ts` (+ `.test.ts` + `rfc3161`… no — its own fixtures), `src/lib/gateway/assets.ts`, `src/app/gateway/install.sh/route.ts`, `src/app/gateway/compose.yml/route.ts`, `src/app/(app)/admin/connectors/gateway-guide-button.tsx`, `deploy/gateway/`.
- `src/app/(app)/admin/connectors/connector-form.tsx` — drop the gateway-guide-button usage; update the gateway-host toggle copy.

---

### Task 1: Bundle guacd into the connector command

**Files:**
- Modify: `src/lib/connector/repair.ts`
- Modify: `src/lib/connector/repair.test.ts`

**Interfaces:**
- Produces: `runCommand`/`buildInstallCommand`/`buildReconfigureCommand`/`buildConnectorUpdateCommand` emit guacd provisioning when `gatewayHost` is true (same signatures as today).

- [ ] **Step 1: Extend the failing test.** In `src/lib/connector/repair.test.ts`, add:

```ts
describe("gateway-host bundles guacd", () => {
  it("install with gatewayHost includes guacd + network + recordings volume", () => {
    const cmd = buildInstallCommand("CODE123", "https://mgr.example.com", "wss://connect.example.com", true);
    expect(cmd).toContain("--name captivo-guacd");
    expect(cmd).toContain("--network captivo-gateway");
    expect(cmd).toContain("captivo_guacd_recordings");
    expect(cmd).toContain("guacamole/guacd:1.5.5");
    expect(cmd).toContain("docker run -d --name access-connector");
  });
  it("install without gatewayHost has no guacd", () => {
    const cmd = buildInstallCommand("CODE123", "https://mgr.example.com", "wss://connect.example.com", false);
    expect(cmd).not.toContain("captivo-guacd");
    expect(cmd).not.toContain("guacamole/guacd");
  });
  it("update with gatewayHost re-provisions guacd", () => {
    const cmd = buildConnectorUpdateCommand("https://mgr.example.com", "wss://connect.example.com", true);
    expect(cmd).toContain("--name captivo-guacd");
    expect(cmd).toContain("docker pull ghcr.io/kurtserdar/captivo-access-connector:latest");
  });
});
```

- [ ] **Step 2: Run to fail.** `pnpm test src/lib/connector/repair.test.ts` → FAIL (no `captivo-guacd`).

- [ ] **Step 3: Implement.** In `src/lib/connector/repair.ts`, replace `runCommand` so `gatewayHost` prepends guacd provisioning (this subsumes the old `ensureNet`):

```ts
function runCommand(managerUrl: string, tunnelUrl: string, code?: string, gatewayHost = false): string {
  const guacd = gatewayHost
    ? `docker network inspect ${GATEWAY_NETWORK} >/dev/null 2>&1 || docker network create ${GATEWAY_NETWORK} && ` +
      `docker run --rm -v captivo_guacd_recordings:/rec busybox chown -R 1000:1000 /rec && ` +
      `docker rm -f captivo-guacd >/dev/null 2>&1; ` +
      `docker run -d --name captivo-guacd --restart unless-stopped --network ${GATEWAY_NETWORK} ` +
      `-v captivo_guacd_recordings:/recordings guacamole/guacd:1.5.5 && `
    : "";
  return (
    guacd +
    "docker run -d --name access-connector --restart unless-stopped " +
    (gatewayHost ? `--network ${GATEWAY_NETWORK} ` : "") +
    `-e MANAGER_URL=${managerUrl} ` +
    `-e DATAPLANE_URL=${tunnelUrl} ` +
    (code ? `-e PAIR_CODE=${code} ` : "") +
    "-v access_connector_data:/data " +
    "ghcr.io/kurtserdar/captivo-access-connector:latest"
  );
}
```
  Update the `GATEWAY_NETWORK` doc comment to say gateway-host connectors reach `captivo-guacd` (not `cap-guacamole`).

- [ ] **Step 4: Run to pass.** `pnpm test src/lib/connector/repair.test.ts` → PASS (existing + 3 new).

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add src/lib/connector/repair.ts src/lib/connector/repair.test.ts && git commit -m "feat(gateway): bundle guacd into the gateway-host connector command"
```

---

### Task 2: GUACD_ADDR default + repoint the launch references

**Files:**
- Modify: `src/app/api/internal/gateway/descriptor/route.ts`
- Modify: `src/app/gateway/[siteId]/session/page.tsx`
- Modify: `src/app/(app)/access/access-view.tsx`

**Interfaces:**
- Consumes: `nativeGatewayEnabled` (existing).

- [ ] **Step 1: GUACD_ADDR default.** In `descriptor/route.ts`, change `(process.env.GUACD_ADDR ?? "guacd:4822")` to `(process.env.GUACD_ADDR ?? "captivo-guacd:4822")`.

- [ ] **Step 2: Session page fallback → notFound.** In `src/app/gateway/[siteId]/session/page.tsx`, replace the `redirect(\`/api/access/gateway/${siteId}/launch\`)` fallback with `notFound()` (import `notFound` from `next/navigation`), since the launch route is being removed and a non-native / disabled gateway session is simply not found:

```ts
import { notFound } from "next/navigation";
// …
if (!nativeGatewayEnabled() || !site || site.accessMode !== "GATEWAY") {
  notFound();
}
```

- [ ] **Step 3: access-view Open → always the session page for GATEWAY.** In `src/app/(app)/access/access-view.tsx`, in `RowAction`, drop the `nativeGateway ? … : launch` branch for GATEWAY and always use the session page:

```ts
const href =
  r.accessMode === "GATEWAY"
    ? `/gateway/${r.siteId}/session`
    : `https://${r.hostname}`;
```
  This makes the `nativeGateway` prop unused in `RowAction`. Remove the `nativeGateway` parameter from `RowAction`, its two call sites, the `AccessView` prop, and the `nativeGateway={nativeGatewayEnabled()}` pass in `access/page.tsx` (and its import) — since GATEWAY is always native now. Verify `pnpm build` after.

- [ ] **Step 4: Verify build.** `pnpm build` → passes.

- [ ] **Step 5: Commit.**

```bash
cd /opt/captivo-access && git add "src/app/api/internal/gateway/descriptor/route.ts" "src/app/gateway/[siteId]/session/page.tsx" "src/app/(app)/access/access-view.tsx" "src/app/(app)/access/page.tsx" && git commit -m "feat(gateway): captivo-guacd default + native-only Open (drop json-auth launch references)"
```

---

### Task 3: Remove the web-app pack + json-auth + grep-clean

**Files:**
- Delete: `src/app/api/access/gateway/[siteId]/launch/route.ts`
- Delete: `src/lib/vault/guac-json.ts`, `src/lib/vault/guac-json.test.ts`, `src/lib/vault/guac-json.fixtures/` (if present)
- Delete: `src/lib/gateway/assets.ts`, `src/app/gateway/install.sh/route.ts`, `src/app/gateway/compose.yml/route.ts`
- Delete: `src/app/(app)/admin/connectors/gateway-guide-button.tsx`
- Delete: `deploy/gateway/` (whole directory)
- Modify: `src/app/(app)/admin/connectors/connector-form.tsx` (drop the gateway-guide-button usage; update toggle copy)

- [ ] **Step 1: Delete the dead files.**

```bash
cd /opt/captivo-access
git rm "src/app/api/access/gateway/[siteId]/launch/route.ts"
git rm src/lib/vault/guac-json.ts src/lib/vault/guac-json.test.ts
[ -d src/lib/vault/guac-json.fixtures ] && git rm -r src/lib/vault/guac-json.fixtures || true
git rm src/lib/gateway/assets.ts src/app/gateway/install.sh/route.ts src/app/gateway/compose.yml/route.ts
git rm "src/app/(app)/admin/connectors/gateway-guide-button.tsx"
git rm -r deploy/gateway
```

- [ ] **Step 2: Fix `connector-form.tsx`.** Remove the `import { GatewayGuideButton }` and its `<GatewayGuideButton … />` usage. Where the gateway-host toggle is, set its help text to: "This host will run remote-desktop gateways — the install command also deploys guacd (RDP/SSH/VNC engine)." Keep the toggle itself (it sets `gatewayHost`).

- [ ] **Step 3: Grep-clean.** Run and confirm empty:

```bash
cd /opt/captivo-access && grep -rn "guac-json\|GATEWAY_COMPOSE\|GatewayGuideButton\|gateway/launch\|GUAC_JSON_SECRET_KEY\|/gateway/install\|/gateway/compose\|deploy/gateway" src | grep -v "src/app/gateway/\[siteId\]/session"
```
  Any hit → fix the dangling import/reference. (The native session route `src/app/gateway/[siteId]/session` stays.)

- [ ] **Step 4: Build + full suite.** `pnpm build` and `pnpm test` → both pass. (The removed `guac-json` tests drop; the rest stay green.)

- [ ] **Step 5: Update docs.** In the install docs (grep `deploy/gateway` in `*.md`), replace the gateway-pack walkthrough with the bundled flow: "Installing a connector as a gateway host also deploys guacd — no separate step. Add a Remote desktop site (protocol/host/port/credentials) and connect." Remove the old pack references.

- [ ] **Step 6: Commit.**

```bash
cd /opt/captivo-access && git add -A && git commit -m "chore(gateway): remove the Guacamole web-app pack + json-auth path (native-only gateway)"
```

---

## Deployment (after all tasks reviewed)

- Manager image bump (descriptor default + removed routes + UI copy). No schema change.
- **Existing install migration:** re-run the gateway-host connector command once (brings up `captivo-guacd`); set/keep `GUACD_ADDR=captivo-guacd:4822` on the manager (now the default); remove the old `cap-guacamole` / `cap-guac-postgres` / `cap-guacd` containers + `GUAC_JSON_SECRET_KEY` env by hand.
- Data-plane/connector Go images unchanged functionally.

## Self-Review

**Spec coverage:**
- Bundle guacd into the connector command (all builders) → Task 1. ✓
- `captivo-guacd` name + network + recordings volume + chown → Task 1. ✓
- `GUACD_ADDR` default `captivo-guacd:4822` → Task 2 Step 1. ✓
- Remove pack/assets/serving routes/gateway-guide → Task 3. ✓
- Remove json-auth launch + guac-json → Task 3 (+ Task 2 repoints its callers first). ✓
- Session-page fallback → notFound; access-view native-only → Task 2. ✓
- Grep-clean → Task 3 Step 3. ✓
- Docs updated → Task 3 Step 5. ✓
- Manager only → respected. ✓

**Placeholder scan:** No TBD/TODO; concrete code/commands throughout. Task 3's `connector-form.tsx` edit references its existing toggle by role (the implementer integrates with the current JSX) with the exact new copy given.

**Type consistency:** `runCommand`/`buildInstallCommand`/`buildConnectorUpdateCommand`/`buildReconfigureCommand` keep their signatures (Task 1). `GATEWAY_NETWORK` constant reused. `RowAction` loses its `nativeGateway` param consistently across definition + call sites + `AccessView` prop + `access/page.tsx` (Task 2 Step 3). The removed `guac-json`/launch symbols have no remaining consumers after Task 2 repoints and Task 3 deletes (grep-clean enforces).
