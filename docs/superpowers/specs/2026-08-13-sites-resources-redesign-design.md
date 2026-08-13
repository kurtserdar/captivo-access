# Resources View Redesign — Slice 3 of the table pass

**Status:** Approved via mockup (2026-08-13): **Cards = Direction B (status strip)**, **List = Direction C (compact row-cards)**.
**Backlog:** punch-list #7, slice 3 of 3 (final)
**Ships as:** v0.48.0 (manager only; UI + CSS — no schema, no dataplane, no connector)

## Goal

Redesign the `/admin/sites` "Configured resources" view (the part the user liked
least). The Cards/List toggle stays, but:
- **Cards view →** Direction B: a colored **status strip** on the card's left edge
  encodes reachability at a glance (green up / red down / grey unknown), with a
  cleaner header + address + health line + footer actions.
- **List view →** Direction C: replace the plain table with **compact horizontal
  row-cards** (avatar + identity left · address/connector middle · health right ·
  actions), fitting many resources in little height.

Only `sites-view.tsx` render + `globals.css` change. The search box (v0.47.0),
view toggle, and the `Actions`/`HealthPill`/`GatewayPill`/`SiteAvatar` helpers are
reused unchanged.

## Health state

A shared local helper drives the strip/dot color:

```ts
function healthState(s: SiteRow): "up" | "down" | "unknown" {
  const noAddress = s.accessMode !== "GATEWAY" && s.upstreamUrl == null;
  if (noAddress || s.probeOk == null) return "unknown";
  return s.probeOk ? "up" : "down";
}
```

Card/row gets a class `hs-up | hs-down | hs-unknown`; CSS colors a 4px left strip
(`::before`) accordingly. `HealthPill` still renders the textual health (pill +
latency + detail + "probed ago").

## Cards view (Direction B)

Per resource card (`className="card site-card hs-<state>"`):
- Header: `SiteAvatar` + name + `GatewayPill`.
- Address block: hostname (truncate + Copy); a `→ <internal address> · <connector>`
  sub-line (internal = `upstreamUrl ?? gatewayTarget`), when present.
- Health line: `HealthPill` + `· N users` when `grantCount > 0`.
- Footer: `Actions` (Test / Edit / Delete).

## List view (Direction C)

Replace the `<table>` with a `.site-rowlist` (flex column) of
`.site-rowcard hs-<state>` items, each a flex row:
- `.src-id`: avatar + (name + GatewayPill, hostname sub with Copy).
- `.src-mid`: internal address (truncate + Copy) + `<connector> · N users` sub.
- `.src-health`: `HealthPill`.
- `.src-acts`: `Actions`.
- Wraps on narrow screens (`max-width:760px` → mid goes full-width).

## CSS

New/updated in `globals.css` (`/* ---- sites: card/list view ---- */` block):
strip `::before` rules for `.site-card`/`.site-rowcard` × `hs-*`; `.site-card-addr`,
`.site-card-health`; `.site-rowlist`, `.site-rowcard`, `.src-id`, `.src-idtext`,
`.src-mid`, `.src-health`, `.src-acts`. The old right-aligned `.site-card-meta` /
`.site-card-mrow` / `.site-card-k` / `.site-card-v` rules are removed (that layout
is gone). Cards + rowcards use `overflow:hidden` so the strip clips to the rounded
corners. Uses only cross-theme tokens (`--ok`/`--danger`/`--faint`/`--line`/…).

## Testing

- No unit test (presentational). `pnpm build` typechecks the rewritten component.
- Gate-A (after deploy): Cards view shows the left status strip (green/red/grey per
  reachability); List view shows compact row-cards; search still filters both;
  Edit/Test/Delete work; light + dark both clean; nothing wraps mid-character.

## Deploy

**v0.48.0**, manager only. Bump the manager tag, `docker compose up -d
access-manager`.
