# Gateway v2 — Slice A: native remote-desktop site model + form — Design

**Date:** 2026-08-11
**Status:** Approved for planning
**Area:** Sites / native gateway (Pro)

## Problem

Now that the native HTML5 gateway works (RDP/SSH/VNC rendered inside Captivo, credential
injected server-side), the site model is behind. A GATEWAY site is still configured as
"a site pointing at the Guacamole web app" (`hostname` + `upstreamUrl=http://guacamole…`),
and the target credential lives in a **separate, hidden "Vault credential" section** only
reachable on the full-page editor. This is confusing and exposes internals (Guacamole) the
operator no longer needs to see.

The operator can now define RDP/SSH/VNC targets **entirely in Captivo**. The site form
should reflect that: one clean "Remote desktop" type where you enter protocol + host +
port + credential, and nothing about Guacamole.

## Goal (Slice A)

Adding a site offers two clear types:

- **Web app** (today's TRANSPARENT) — unchanged: public hostname + internal address, rrweb
  recording, clipboard, vendor enters their own credentials.
- **Remote desktop / shell** (native GATEWAY) — one form: **protocol (RDP/SSH/VNC) + target
  host + port + username + secret**. No public hostname, no internal web address, no
  Guacamole. The credential is stored in the vault and injected server-side; the vendor
  never sees it.

This is the product-facing model change. Bundled guacd deployment is **Slice B**;
guacd-native recording wiring is **Slice C**.

## Key decisions (delegated to the recommended options)

1. **Two types via the existing `accessMode` enum**, relabeled in the UI (Web app /
   Remote desktop). No new enum.
2. **`hostname` becomes optional** — required for web apps, absent for remote-desktop sites
   (their session is the manager route `/gateway/[id]/session`, not a subdomain).
3. **The vault credential merges into the remote-desktop site form** — protocol/host/port/
   username/secret are first-class fields of the form (backed by the existing
   `VaultCredential`, 1:1 with the site). The separate "Vault credential" section is removed.
4. **Gated by `NATIVE_GATEWAY`** — the "Remote desktop" type appears only when native gateway
   is enabled. (`VAULT_ENABLED` is subsumed; see Scope.)
5. **Recording toggle is out of Slice A** (added with its wiring in Slice C).

## Scope

**In scope (Slice A):**
- `Site.hostname` nullable; validation branches by type.
- Site form: a type selector; web-app fields vs remote-desktop fields.
- Remote-desktop fields (protocol/host/port/username/secret) create/update the site's
  `VaultCredential` in the same save.
- Save route branches: web app requires hostname + upstreamUrl; remote desktop requires
  protocol + host + port + username + secret and stores hostname/upstreamUrl as null.
- Remove the standalone "Vault credential" section from the full-page editor (now inline).
- The "Remote desktop" type is shown only when `nativeGatewayEnabled()`.

**Out of scope (later slices):** bundled guacd deployment + retiring the old gateway pack
(Slice B); recording toggle + guacd recording wiring + replay (Slice C); connector
`gatewayHost` install-command changes (Slice B); credential rotation / multiple targets.

**Unchanged:** the native session page, the guac-tunnel, the descriptor API, the json-auth
launch fallback — all keep working; only the site config UX + model change here.

## Data model

- `Site.hostname`: `String` → `String?` (nullable). Keep `@unique` — Postgres allows
  multiple NULLs under a unique index, so web-app hostnames stay unique and remote-desktop
  sites hold NULL. `upstreamUrl` is already nullable.
- No new columns. The remote-desktop target lives in the existing `VaultCredential`
  (`protocol/targetHost/targetPort/username/secret/secretKind`, encrypted at rest), 1:1 with
  the site. `recordSessions` already exists (used by web apps for rrweb; wired for gateway in
  Slice C).

## Site form

`site-form.tsx` gains a **type selector** at the top: **Web app** / **Remote desktop**
(the latter shown only when native gateway is enabled). Fields shown by type:

- **Web app** (TRANSPARENT): connector, name, public hostname (required), internal address
  (required), recording toggle, clipboard mode, description. As today.
- **Remote desktop** (GATEWAY): connector, name, **protocol** (RDP/SSH/VNC), **target host**,
  **port**, **username**, **secret** (write-only — placeholder "•••• (stored)" when set),
  description. No hostname, no internal address, no clipboard.

For an existing remote-desktop site, the form seeds protocol/host/port/username from its
`VaultCredential` (secret stays write-only). Saving a remote-desktop site upserts the
`VaultCredential` from these fields.

## Save route

`api/admin/sites` (create) + `[id]` (update) branch on `accessMode`:

- **TRANSPARENT:** require `connector`, `name`, `hostname`, `upstreamUrl` (as today);
  validate hostname + upstream URL; `recordSessions`/`clipboardMode` as today.
- **GATEWAY:** require `connector`, `name`, `protocol ∈ {RDP,SSH,VNC}`, `targetHost`,
  `targetPort ∈ [1,65535]`, `username`, `secret` (on create; on update the secret may be
  blank to keep the stored one). Reject if `nativeGatewayEnabled()` is false. Store the site
  with `hostname = null`, `upstreamUrl = null`, and its `VaultCredential`, in a single Prisma
  `$transaction` so a remote-desktop site and its credential are always written together —
  never a site without a credential. (The secret is encrypted via the existing `encrypt()`
  before the transaction.)

New error codes: `remote_desktop_fields_required`, `invalid_protocol`, `invalid_port`,
`native_gateway_disabled`.

## Existing gateway sites

The one existing GATEWAY site already has a `VaultCredential` (it was set during Gate-A). Its
`upstreamUrl` (old Guacamole web-app URL) is simply ignored by the native path and no longer
shown in the form. No migration script needed — the form/save just stop using
hostname/upstream for gateway sites. (Removing the Guacamole web-app pack itself is Slice B.)

## Error handling

- Missing/invalid remote-desktop fields → 400 with the specific code; the form maps each to a
  clear message.
- `NATIVE_GATEWAY` off → the Remote desktop type isn't offered; a direct POST is rejected
  (`native_gateway_disabled`).
- Vault upsert failure on save → the site save reports an error; never store a remote-desktop
  site without its credential.

## Testing

- **Save-route validation (pure where possible):** extract the per-type required-field check
  into a testable helper (`validateSiteInput(mode, body) → {ok}|{error}`) and unit-test:
  web-app needs hostname+upstream; remote-desktop needs protocol/host/port/username/secret;
  bad protocol/port rejected.
- **Form:** build passes; the type selector shows the right fields; secret is write-only.
  (Client-only; covered by build + manual check.)
- **Manual:** create a remote-desktop site (protocol/host/port/creds), confirm the
  `VaultCredential` is stored encrypted and the site has null hostname; Open still launches the
  native session.

## Deployment

- Prisma `db push` makes `hostname` nullable (additive-safe: existing values kept). Bump
  manager + migrate together, run the migrate one-shot.
- Manager-only otherwise; data-plane/connector unchanged in Slice A.
