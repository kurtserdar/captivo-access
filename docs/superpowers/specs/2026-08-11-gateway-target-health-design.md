# Gateway target health — reachability for remote-desktop sites

**Status:** approved design (2026-08-11)
**Repo:** `/opt/captivo-access` (public OSS, English-only)

## Goal

Give remote-desktop (GATEWAY) sites a real reachability status by TCP-probing
their target through the connector, so the dashboard "Sites reachable X/Y" card
and the Sites page reflect actual gateway health instead of counting every
gateway as not-reachable (a false warning today).

## Problem

Reachability is derived from `Site.probeOk`. The site-health cron only probes
sites that have an `upstreamUrl` (TRANSPARENT/web-app sites); GATEWAY sites have
no `upstreamUrl`, so they are skipped, `probeOk` stays `null`, and they are
counted in the metric's denominator (`sites`) but never in the numerator
(`probeOk: true`). A single healthy gateway therefore shows the dashboard as
e.g. 1/2 in a warning tone, and the Sites page shows the gateway as "No address".

## Key facts (why this is small)

- The existing probe is already a **raw TCP connect** through the connector
  (`connector` `handleProbe` → `net.DialTimeout("tcp", host:port)`), not an HTTP
  request. It only requires the probe URL's scheme to be `http`/`https` and then
  connects to the derived `host:port`.
- A gateway target is `VaultCredential.targetHost` + `targetPort`, stored
  **plaintext** (only `secret` is encrypted), so probing needs no decryption.
- `Site.vaultCredential` (a `VaultCredential?` relation) already exists.

So a gateway target is probed by passing `http://<targetHost>:<targetPort>` to
the existing probe — it TCP-connects to the target's real port and never speaks
HTTP. No connector or data-plane change is needed.

## Components

### 1. Gateway probe helper (`src/lib/connector/health.ts`)

Add a pure URL builder + a gateway probe wrapper beside `probeSite`:

```ts
// Build the probe URL for a gateway target. The scheme is only there to satisfy
// the connector's URL parser; the probe is a raw TCP connect to host:port and
// never makes an HTTP request. IPv6 hosts are bracketed.
export function gatewayProbeUrl(targetHost: string, targetPort: number): string {
  const host = targetHost.includes(":") ? `[${targetHost}]` : targetHost;
  return `http://${host}:${targetPort}`;
}

export async function probeGatewaySite(site: { connectorId: string; targetHost: string; targetPort: number }): Promise<ProbeResult> {
  const res = await probeConnector({ connectorId: site.connectorId, upstreamUrl: gatewayProbeUrl(site.targetHost, site.targetPort) });
  if ("error" in res) return { probeOk: false, probeDetail: res.error, probeLatencyMs: null };
  return { probeOk: true, probeDetail: "reachable", probeLatencyMs: res.latencyMs };
}
```

`ProbeResult` and `probeConnector` are the existing types/functions.

### 2. Site-health cron (`src/app/api/cron/site-health/route.ts`)

Also probe gateway sites, writing the same `probeOk/probeDetail/probeLatencyMs/probedAt`
columns and feeding the same up/down transition notifications.

- Fetch gateway sites with their target:
  ```ts
  const gateways = await db.site.findMany({
    where: { accessMode: "GATEWAY" },
    select: { id: true, name: true, probeOk: true, connectorId: true, vaultCredential: { select: { targetHost: true, targetPort: true } } },
  });
  ```
- Probe each gateway that has a `vaultCredential` (skip half-configured ones,
  like a TRANSPARENT site with no `upstreamUrl`): call `probeGatewaySite`,
  update the site, run `classifyTransition`/`notifyTransition` exactly as for
  web-app sites, and add to the `reachable`/`unreachable` tally. Reuse the same
  bounded-concurrency `POOL` loop pattern.
- The response `skipped` count includes gateways with no credential.

### 3. Test-connection route (`src/app/api/admin/sites/[id]/test/route.ts`)

For a GATEWAY site, probe the vault target instead of returning "no address":

- Select `accessMode` + `vaultCredential { targetHost, targetPort }` alongside
  the current fields.
- If `accessMode === "GATEWAY"`: if there's no `vaultCredential`, return the
  existing "no address"-style not-configured response; otherwise
  `probeGatewaySite({ connectorId, targetHost, targetPort })` and return/persist
  the result the same way the upstream probe does (update `probedAt/probeOk/
  probeDetail/probeLatencyMs`).
- TRANSPARENT sites keep the current `upstreamUrl` path.

### 4. Sites page health pill (`src/app/(app)/admin/sites/sites-view.tsx`)

`HealthPill` currently shows "No address" whenever `upstreamUrl == null`, which
now wrongly hides a gateway's real health. Change it so a **gateway** site shows
its probe state (Reachable / Down / Unknown) from `probeOk` — the same rendering
web-app sites use — and only TRANSPARENT sites with no `upstreamUrl` show
"No address":

- gateway with `probeOk === true` → "Reachable"; `false` → "Unreachable" (+ detail);
  `null` → "Not checked".
- The `SiteRow` already carries `accessMode`, `probeOk`, `probeDetail`,
  `probeLatencyMs`, `probedAgo`; no new fields.

### 5. Dashboard (`src/lib/dashboard/stats.ts`) — no change

Once gateways are probed they get a real `probeOk`, so `sitesReachable` /
`sites` counts them correctly: healthy gateways join the numerator, an
unreachable gateway is genuinely down (real warning, not false). No stats change.

## Data flow

1. Cron runs → probes web-app sites (upstreamUrl) **and** gateway sites (vault
   target, via `http://host:port` TCP connect) → updates `probeOk` on each.
2. Dashboard reads `probeOk` counts → accurate reachable/total.
3. Sites page reads each site's `probeOk` → gateway shows Reachable/Down.
4. Admin clicks "Test connection" on a gateway → immediate target probe.

## Error handling / edge cases

- Gateway with no vault credential (mid-setup) → skipped (counts as `skipped`,
  `probeOk` stays `null` → "Not checked"), never reported down.
- IPv6 target host → bracketed in the probe URL.
- Egress boundary (`ALLOWED_TARGETS`) → the probe is checked against it and fails
  closed, exactly like a dial (a probe reaches the same network as a session).
- Connector offline → probe returns an error → gateway shows "Unreachable"
  (correct — the session couldn't be established either).

## Non-goals

- No new schema, no data-plane/connector change (the TCP probe already exists).
- No per-gateway probe interval / on-create immediate probe (the cron + manual
  "Test connection" cover it, same as web-app sites).
- Recording/gateway session behavior is untouched.

## Capability gating / config

- No new env; no schema change → **no `access-migrate`**. Manager-only change.

## Testing

**TS (vitest):**
- `gatewayProbeUrl`: `("10.0.0.5", 3389)` → `"http://10.0.0.5:3389"`; a hostname
  target → `"http://host:22"`; an IPv6 target `"fe80::1"` → `"http://[fe80::1]:5900"`.

**Gate A (live, operator):**
- A gateway site with a reachable RDP target shows **Reachable** on the Sites
  page after the next cron run (or immediately via "Test connection"); the
  dashboard "Sites reachable" no longer shows a false warning for it.
- Stop the target (or point the site at a dead port) → the gateway shows
  **Unreachable** and a site-down notification fires.
- A gateway with no credential yet shows **Not checked**, not down.

## Deploy notes

- Manager-only → bump `access-manager`. No migrate, no data-plane/connector
  change, no connector re-run.
- English-only strings + GitHub Release note.

## File map

**Modify:** `src/lib/connector/health.ts` (+ a small `health.test.ts` for
`gatewayProbeUrl`), `src/app/api/cron/site-health/route.ts`,
`src/app/api/admin/sites/[id]/test/route.ts`,
`src/app/(app)/admin/sites/sites-view.tsx`.
