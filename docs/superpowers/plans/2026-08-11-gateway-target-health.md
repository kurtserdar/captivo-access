# Gateway Target Health — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give remote-desktop (GATEWAY) sites a real reachability status by TCP-probing their target through the connector, so the dashboard and Sites page reflect actual gateway health instead of a false "not reachable".

**Architecture:** Reuse the existing connector TCP-connect probe (it only needs an `http(s)://host:port` URL and never speaks HTTP). Probe a gateway's plaintext `VaultCredential.targetHost:targetPort`, write the same `probeOk/probeDetail/probeLatencyMs` columns the web-app probe uses, and surface it in the cron, the Test-connection button, and the Sites-page health pill. The dashboard corrects itself once gateways carry a real `probeOk`.

**Tech Stack:** Next.js 16 (manager), Prisma 7, vitest.

## Global Constraints

- **English only**; **no Claude signature** in commits.
- **Manager-only** — no schema change (`no access-migrate`), no data-plane/connector change (the TCP probe already exists), no connector re-run.
- **The probe is a raw TCP connect** — the `http://` scheme only satisfies the connector's URL parser; it never makes an HTTP request.
- **Gateway target is plaintext** (`VaultCredential.targetHost`/`targetPort`) — no decryption needed.
- **Skip half-configured gateways** (no `vaultCredential`) — like a web-app site with no `upstreamUrl`; never report them down.
- **Verify:** TS build `pnpm build`; TS tests `pnpm test`.

---

### Task 1: `gatewayProbeUrl` + `probeGatewaySite`

**Files:**
- Modify: `src/lib/connector/health.ts`
- Test: `src/lib/connector/health.test.ts` (create)

**Interfaces:**
- Consumes: `probeConnector` + `ProbeResult` (already in `health.ts` / `dataplane.ts`).
- Produces:
  - `gatewayProbeUrl(targetHost: string, targetPort: number): string` — `http://<host>:<port>`, IPv6 bracketed.
  - `probeGatewaySite(site: { connectorId: string; targetHost: string; targetPort: number }): Promise<ProbeResult>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/connector/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gatewayProbeUrl } from "./health";

describe("gatewayProbeUrl", () => {
  it("builds an http URL with the explicit target port", () => {
    expect(gatewayProbeUrl("10.0.0.5", 3389)).toBe("http://10.0.0.5:3389");
  });
  it("works for a hostname target", () => {
    expect(gatewayProbeUrl("rdp.internal", 22)).toBe("http://rdp.internal:22");
  });
  it("brackets an IPv6 target host", () => {
    expect(gatewayProbeUrl("fe80::1", 5900)).toBe("http://[fe80::1]:5900");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/connector/health.test.ts`
Expected: FAIL — `gatewayProbeUrl` is not exported.

- [ ] **Step 3: Implement the helpers in `src/lib/connector/health.ts`**

Append below `probeSite`:

```ts
// Build the probe URL for a gateway target. The scheme only satisfies the
// connector's URL parser; the probe is a raw TCP connect to host:port and never
// makes an HTTP request. IPv6 hosts are bracketed.
export function gatewayProbeUrl(targetHost: string, targetPort: number): string {
  const host = targetHost.includes(":") ? `[${targetHost}]` : targetHost;
  return `http://${host}:${targetPort}`;
}

// Probe a GATEWAY site's target (RDP/SSH/VNC host:port) with a raw TCP connect
// through its connector, timing the round trip — the same mechanism used for a
// web-app site's upstream.
export async function probeGatewaySite(site: { connectorId: string; targetHost: string; targetPort: number }): Promise<ProbeResult> {
  const res = await probeConnector({ connectorId: site.connectorId, upstreamUrl: gatewayProbeUrl(site.targetHost, site.targetPort) });
  if ("error" in res) return { probeOk: false, probeDetail: res.error, probeLatencyMs: null };
  return { probeOk: true, probeDetail: "reachable", probeLatencyMs: res.latencyMs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/connector/health.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connector/health.ts src/lib/connector/health.test.ts
git commit -m "feat(gateway): probeGatewaySite — TCP-probe a remote-desktop target via the connector"
```

---

### Task 2: Probe gateway sites in the site-health cron

**Files:**
- Modify: `src/app/api/cron/site-health/route.ts`

**Interfaces:**
- Consumes: `probeGatewaySite` (Task 1); `classifyTransition`/`notifyTransition` (already imported); `Site.vaultCredential` relation.

> No unit test (cron route with DB + network, like the rest of the file). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Import `probeGatewaySite`**

In `src/app/api/cron/site-health/route.ts`, change the health import:

```ts
import { probeSite, probeGatewaySite } from "@/lib/connector/health";
```

- [ ] **Step 2: Fetch + probe gateway sites after the web-app loop**

After the existing `for (let i = 0; i < toProbe.length; i += POOL) { … }` loop (which increments `reachable`/`unreachable`), and before the `return`, add:

```ts
  // GATEWAY sites have no upstreamUrl; probe their remote-desktop target
  // (VaultCredential.targetHost:targetPort) with the same TCP connect.
  const gateways = await db.site.findMany({
    where: { accessMode: "GATEWAY" },
    select: {
      id: true,
      name: true,
      probeOk: true,
      connectorId: true,
      vaultCredential: { select: { targetHost: true, targetPort: true } },
    },
  });
  const gwToProbe = gateways.filter((g) => g.vaultCredential !== null);
  for (let i = 0; i < gwToProbe.length; i += POOL) {
    const batch = gwToProbe.slice(i, i + POOL);
    await Promise.all(
      batch.map(async (site) => {
        const vc = site.vaultCredential!;
        const { probeOk, probeDetail, probeLatencyMs } = await probeGatewaySite({
          connectorId: site.connectorId,
          targetHost: vc.targetHost,
          targetPort: vc.targetPort,
        });
        if (probeOk) reachable++;
        else unreachable++;
        const transition = classifyTransition(site.probeOk, probeOk);
        if (transition) {
          const detail = transition === "site_down" ? probeDetail : null;
          await notifyTransition({ type: transition, siteId: site.id, siteName: site.name, detail });
        }
        await db.site.update({ where: { id: site.id }, data: { probedAt: now, probeOk, probeDetail, probeLatencyMs } });
      }),
    );
  }
```

- [ ] **Step 3: Include gateways in the response tally**

Change the final `return`:

```ts
  return NextResponse.json({
    checked: toProbe.length + gwToProbe.length,
    reachable,
    unreachable,
    skipped: sites.length - toProbe.length - gwToProbe.length,
  });
```

(`sites.length` already counts every site including gateways, so `skipped` now = web-apps-without-upstream + gateways-without-credential.)

- [ ] **Step 4: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/site-health/route.ts
git commit -m "feat(gateway): site-health cron probes remote-desktop targets"
```

---

### Task 3: Test-connection for gateway sites

**Files:**
- Modify: `src/app/api/admin/sites/[id]/test/route.ts`
- Modify: `src/app/(app)/admin/sites/test-connection-button.tsx`

**Interfaces:**
- Consumes: `probeGatewaySite` (Task 1); existing `classifyTransition`/`notifyTransition`.
- Produces: for a gateway site the route probes the target and returns `{ ok, latencyMs }` on success or `{ error }` on failure; the button renders a "Reachable" result.

> No unit test (DB + network route). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Handle gateway sites in the test route**

In `src/app/api/admin/sites/[id]/test/route.ts`:

- add `probeGatewaySite` to the health import:
  ```ts
  import { probeSite, probeGatewaySite } from "@/lib/connector/health";
  ```
- extend the site `select` with `accessMode` + the vault target:
  ```ts
    select: {
      name: true,
      connectorId: true,
      upstreamUrl: true,
      insecureSkipVerify: true,
      probeOk: true,
      accessMode: true,
      vaultCredential: { select: { targetHost: true, targetPort: true } },
      connector: { select: { status: true } },
    },
  ```
- after the `connector_revoked` guard and BEFORE the `if (!site.upstreamUrl)` guard, add the gateway branch (so gateway sites don't hit the "no_upstream_url" path):

```ts
  if (site.accessMode === "GATEWAY") {
    if (!site.vaultCredential) {
      return NextResponse.json({ error: "no_upstream_url" });
    }
    const probe = await probeGatewaySite({
      connectorId: site.connectorId,
      targetHost: site.vaultCredential.targetHost,
      targetPort: site.vaultCredential.targetPort,
    });
    const transition = classifyTransition(site.probeOk, probe.probeOk);
    if (transition) {
      const detail = transition === "site_down" ? probe.probeDetail : null;
      await notifyTransition({ type: transition, siteId: id, siteName: site.name, detail });
    }
    await db.site.update({
      where: { id },
      data: { probedAt: new Date(), probeOk: probe.probeOk, probeDetail: probe.probeDetail, probeLatencyMs: probe.probeLatencyMs },
    });
    return NextResponse.json(probe.probeOk ? { ok: true, latencyMs: probe.probeLatencyMs } : { error: probe.probeDetail });
  }
```

(The existing TRANSPARENT path — `if (!site.upstreamUrl)` then `proxyThroughConnector` + `probeSite` — is unchanged and now only runs for non-gateway sites.)

- [ ] **Step 2: Render the gateway result in the button**

In `src/app/(app)/admin/sites/test-connection-button.tsx`, the handler currently checks `body.error` then `body.status`. Add an `ok` branch between them so a gateway success shows a positive result. After the `if (body?.error) { … return; }` block, add:

```tsx
      if (body?.ok === true) {
        setResult(typeof body.latencyMs === "number" ? `Reachable · ${body.latencyMs} ms` : "Reachable");
        return;
      }
```

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/admin/sites/[id]/test/route.ts" "src/app/(app)/admin/sites/test-connection-button.tsx"
git commit -m "feat(gateway): Test connection probes the remote-desktop target"
```

---

### Task 4: Show gateway health on the Sites page

**Files:**
- Modify: `src/app/(app)/admin/sites/sites-view.tsx`

**Interfaces:**
- Consumes: `SiteRow` (already carries `accessMode`, `probeOk`, `probeDetail`, `probeLatencyMs`, `probedAgo`, `upstreamUrl`).

> No unit test (presentational). Verified by `pnpm build` + Gate A.

- [ ] **Step 1: Show a gateway's probe state instead of "No address"**

In `src/app/(app)/admin/sites/sites-view.tsx`, change `HealthPill` so "No address" only applies to a non-gateway site with no upstream; gateway sites render their probe state like web apps:

```tsx
function HealthPill({ s }: { s: SiteRow }) {
  const noAddress = s.accessMode !== "GATEWAY" && s.upstreamUrl == null;
  return (
    <>
      {noAddress ? (
        <span className="pill neutral">No address</span>
      ) : s.probeOk == null ? (
        <span className="pill neutral">Not checked</span>
      ) : s.probeOk ? (
        <span className="pill ok">Reachable</span>
      ) : (
        <span className="pill danger">Unreachable</span>
      )}
      {s.probeDetail && s.probeOk === false && <div className="cell-sub">{s.probeDetail}</div>}
      {s.probeOk === true && s.probeLatencyMs != null && <div className="cell-sub">{s.probeLatencyMs} ms</div>}
      {s.probedAgo && <div className="cell-sub">{s.probedAgo}</div>}
    </>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/admin/sites/sites-view.tsx"
git commit -m "feat(gateway): show remote-desktop reachability on the Sites page"
```

- [ ] **Step 4: Gate A — live validation (operator, after deploy)**

Manual acceptance, after deploy (bump `access-manager`; no migrate). Confirm:

1. A gateway site with a reachable RDP target: click **Test connection** → "Reachable · N ms"; after the next site-health cron (or the manual test), the Sites page shows **Reachable** and the dashboard "Sites reachable X/Y" no longer shows a false warning caused by that gateway.
2. Point the gateway at a dead host/port (or stop the target) → **Test connection** shows "Failed: …"; the row shows **Unreachable**; a site-down notification fires.
3. A gateway with no vault credential shows **Not checked**, never "down".

---

## Self-Review

**1. Spec coverage:**
- `gatewayProbeUrl` + `probeGatewaySite` (health.ts) → Task 1. ✓
- Cron probes gateways (vault target, same columns + notifications, tally) → Task 2. ✓
- Test-connection route for gateway + button render → Task 3. ✓
- Sites-page health pill shows gateway state (drop "No address" for gateway) → Task 4. ✓
- Dashboard no change (self-corrects) → covered by Tasks 2–4 producing real `probeOk`; no stats task needed. ✓
- Edge cases (no credential skip, IPv6 bracket, egress fail-closed inherited, connector offline → unreachable) → Task 1 (`gatewayProbeUrl`/reuse), Task 2 (`gwToProbe` filter). ✓
- Manager-only, no schema/migrate → Global Constraints + Task 4 Gate A. ✓

**2. Placeholder scan:** No TBD/TODO; every code step carries real code. The three untested tasks (cron, route, UI) state the justification (DB/network routes and presentational components, matching the file's existing untested pattern).

**3. Type consistency:**
- `gatewayProbeUrl(host: string, port: number): string` and `probeGatewaySite({connectorId, targetHost, targetPort}): Promise<ProbeResult>` (Task 1) are consumed with those exact shapes in Tasks 2 and 3. ✓
- `ProbeResult` fields (`probeOk`, `probeDetail`, `probeLatencyMs`) used identically to the existing `probeSite` result in the cron and test route. ✓
- `site.vaultCredential.{targetHost,targetPort}` (Prisma relation) selected the same way in Tasks 2 and 3. ✓
- `SiteRow.accessMode` used in Task 4 already exists on the type (line 15 of `sites-view.tsx`). ✓
- Button response contract `{ ok, latencyMs }` / `{ error }` (Task 3 route) matches the button's `body.ok`/`body.latencyMs`/`body.error` reads (Task 3 button). ✓
