# Shared Table Look — "Refined Hairline" (Direction A)

**Status:** Approved via mockup (2026-08-13, Direction A chosen)
**Backlog:** punch-list #7, slice 1 of 3 (shared table visual polish → filters per-table → /admin/sites resources redesign)
**Ships as:** v0.46.0 (manager only; CSS only — no schema, no dataplane, no connector, no component changes)

## Goal

Modernize the shared `.table` primitive so all ~18 tables look more polished and
professional at once, via a single CSS change. Direction A ("Refined hairline")
was chosen from the mockup: the current hairline aesthetic, refined — softer
headers, more breathing room, a card surface with a subtle shadow, and a teal
accent bar that slides in on row hover.

## Scope

- **CSS only**, in `src/app/globals.css` — the `.table` / `.table-wrap` block.
- Applies globally to every `.table` (connectors, users, grants, invites, live,
  sessions, recordings, sites, audit, directory mappings, notifications, small
  panels, etc.) — no per-table edits.
- Filters/search and the `/admin/sites` resources redesign are **separate later
  slices** (not this one).

## Exact changes

Replace the current rules:

```css
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius-lg);}
.table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}
.table th{text-align:left;font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);font-weight:500;padding:.7rem .9rem;border-bottom:1px solid var(--line);background:var(--surface-2);}
.table td{padding:.72rem .9rem;border-bottom:1px solid var(--line-soft);font-size:.875rem;}
.table tr:last-child td{border-bottom:none;}
.table tbody tr:hover{background:var(--surface-hover);}
```

with:

```css
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow);}
.table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}
.table th{text-align:left;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;
  color:var(--faint);font-weight:600;padding:.7rem 1.1rem;border-bottom:1px solid var(--line);}
.table td{padding:.95rem 1.1rem;border-bottom:1px solid var(--line-soft);font-size:.9rem;}
.table tr:last-child td{border-bottom:none;}
.table tbody tr{transition:background .12s;}
.table tbody tr:hover{background:var(--surface-hover);}
.table tbody td:first-child{font-weight:550;box-shadow:inset 3px 0 0 transparent;transition:box-shadow .12s;}
.table tbody tr:hover td:first-child{box-shadow:inset 3px 0 0 var(--accent);}
```

Deltas: header loses the mono font + `surface-2` tint (cleaner), goes softer
(`--faint`, 600, wider padding, `.72rem`, tighter letter-spacing); cells get more
padding + `.9rem`; the wrap gains a solid surface + subtle `--shadow`; rows
transition; the first column is medium-weight and grows a teal accent bar on hover.

## Non-negotiable guardrails

- **KEEP `.table td{white-space:nowrap;}`** (the separate rule further down in
  globals.css) untouched. `overflow-wrap:anywhere` on cells previously broke prod
  (v0.11.2, reverted) — do not reintroduce wrapping.
- Only CSS custom properties that exist in **both** light and dark are used
  (`--surface`, `--faint`, `--accent`, `--shadow`, `--surface-hover`, `--line`,
  `--line-soft`). Verify both themes.
- No changes to `.cell-sub`, `.cell-truncate`, `.cell-inline`, `.pill`, `.btn`, or
  any table component's JSX.

## Testing

- CSS-only; no unit test. `pnpm build` typechecks (CSS can't break types but
  confirms the build). Visual verification is Gate-A.
- Gate-A (after deploy): every table page (Connectors, Users, Grants, Invites,
  Sessions, Recordings, Sites, Audit, Live) renders with the refined look in
  **both** light and dark; row hover shows the teal accent bar; pills/buttons/IPs
  never wrap mid-character (nowrap intact); no double-heavy elevation that looks
  broken inside cards.

## Deploy

**v0.46.0**, manager only. Bump the manager tag, `docker compose up -d
access-manager`.
