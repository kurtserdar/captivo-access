# Credential Vault (V1 + V2) — Design

**Date:** 2026-08-10
**Status:** Approved for planning
**Area:** Pro tier / privileged access

## Problem

Today, when an operator publishes a GATEWAY (Guacamole) site, they configure the
RDP/SSH/VNC target credentials **inside Guacamole** and the vendor logs into
Guacamole separately (a second login on top of Captivo). The target password
lives in Guacamole's own DB, unmanaged by Captivo, and the double login is
friction.

The credential vault is the CyberArk-style core of the Pro tier: store target
credentials **in Captivo, encrypted at rest**, and inject them into the session
so the vendor connects to the RDP/SSH/VNC target **without ever seeing the
password and without logging into Guacamole**.

## Goal (end-to-end, this spec)

A vendor with a valid grant clicks **Open** on a GATEWAY site and lands directly
in the isolated, recorded RDP/SSH/VNC session — no Guacamole login, no password
entry. The password stays encrypted in Captivo and is handed to Guacamole only
inside a signed, encrypted, short-lived token the browser cannot read.

## Key decisions (approved)

1. **One credential per GATEWAY site** (the site represents one target). Multiple
   targets per site is a later concern (YAGNI).
2. **Task 1 is a de-risk spike:** prove a Captivo-generated signed+encrypted blob
   actually authenticates against a running Guacamole (with the
   `guacamole-auth-json` extension) before building the rest on top.
3. **Capability-gated, off by default:** a `VAULT_ENABLED` env flag (like
   `RECORDING_ENABLED`; license later). When off, the vault UI and the launch
   flow are inert.
4. **Manager only.** The Go data-plane and connector are not changed; injection
   is a manager flow that reuses the existing internal-dial (as `probeSite`
   already reaches internal sites through the connector).

## Scope

**In scope:**
- `VaultCredential` model + encrypted-at-rest storage.
- The `guacamole-auth-json` blob generator (sign + encrypt, byte-compatible with
  the extension), proven against a real Guacamole in Task 1.
- Gateway pack: bundle the `guacamole-auth-json` extension + a shared
  `JSON_SECRET_KEY`.
- A manager launch flow that builds the blob from the vault and hands the vendor
  an authenticated Guacamole session.
- Admin UI to set a site's vault credential; vendor **Open** routes GATEWAY sites
  through the launch flow.
- `VAULT_ENABLED` capability gate.

**Out of scope (later):** multiple targets per site, credential rotation/expiry
policies, per-grant credential overrides, reveal/checkout audit workflows,
non-gateway (transparent web form-fill) injection, SSH key passphrases beyond a
single stored secret.

## Data model

```prisma
enum VaultProtocol { RDP SSH VNC }
enum VaultSecretKind { PASSWORD KEY }

model VaultCredential {
  id         String          @id @default(cuid())
  siteId     String          @unique
  site       Site            @relation(fields: [siteId], references: [id], onDelete: Cascade)
  protocol   VaultProtocol
  targetHost String
  targetPort Int
  username   String
  secret     String          // AES-256-GCM ciphertext (password OR private key)
  secretKind VaultSecretKind @default(PASSWORD)
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
}
```

`Site` gains the reverse relation field `vaultCredential VaultCredential?`
(Prisma requires it). `secret` is encrypted with the existing `@/lib/crypto`
`encrypt()`/`decrypt()` (AES-256-GCM). The plaintext is never returned to any
client — the admin UI is write-only for the secret (shows "set" / "not set",
never the value).

## The guacamole-auth-json blob (the key mechanism)

The `guacamole-auth-json` extension authenticates a request carrying a `data`
parameter that is a base64 of: **AES-128-CBC( HMAC-SHA256(json) ‖ json )**, where
the key is the 16 bytes of the shared 128-bit `JSON_SECRET_KEY` (32 hex chars),
the IV is 16 zero bytes, and the JSON is:

```json
{
  "username": "<vendor email>",
  "expires": <epoch millis, short-lived>,
  "connections": {
    "<site name>": {
      "protocol": "rdp|ssh|vnc",
      "parameters": {
        "hostname": "<targetHost>",
        "port": "<targetPort>",
        "username": "<vault username>",
        "password": "<vault secret>",
        "recording-path": "/recordings",
        "recording-name": "<unique session name — Guacamole-native recording>",
        "recording-include-keys": "true"
      }
    }
  }
}
```

Node generation (isolated in one module, `src/lib/vault/guac-json.ts`):
`sig = hmacSHA256(key, json)` → `aes-128-cbc(key, zeroIV, sig‖json)` →
`base64`. This module is the crux; **Task 1 validates a generated blob
authenticates against a live Guacamole** and pins the exact JSON shape + handoff.

## Injection flow (manager only)

1. Vendor clicks **Open** on a GATEWAY site → `POST /api/access/gateway/[siteId]/launch`.
2. The launch handler: `requireUser` → `evaluateAccess(user, site, now)` must
   allow → load `VaultCredential` for the site → decrypt the secret → build the
   JSON doc (short `expires`, recording on) → sign+encrypt into the `data` blob.
3. Hand the vendor an authenticated Guacamole session. **The exact handoff wire is
   established by the Task 1 spike** — the two candidates, in preference order:
   - **(a) Server-side token, then redirect:** the manager POSTs `data=<blob>` to
     the gateway site's `/api/tokens` *through the connector* (reusing the
     internal-dial that `probeSite` uses), receives the Guacamole `authToken`, and
     redirects the vendor's browser into the Guacamole client already
     authenticated. No blob touches the browser; no cross-origin POST.
   - **(b) `?data=` redirect:** if Guacamole accepts the blob as a request
     parameter on load, redirect the browser to the gateway host carrying `data`.
   Task 1 picks whichever actually works and the plan is written to it. Either
   way the vendor never receives the plaintext password (in (a) the blob never
   leaves the manager; in (b) the password inside the blob is encrypted).

Because injection is a manager flow reusing the existing internal-dial, **no Go /
data-plane / connector change is required.**

## Gateway pack change

`deploy/gateway/`: add the `guacamole-auth-json` extension into the Guacamole
container's `GUACAMOLE_HOME/extensions`, and set `JSON_SECRET_KEY` (generated by
`setup.sh`, same value handed to the Captivo manager as an env var). Document the
one shared secret in the gateway README. The extension is additive; existing
guacadmin login still works (fallback / break-glass).

## Admin UI + vendor change

- **Admin:** on a GATEWAY site's page, a "Vault credential" section — protocol,
  target host, port, username, secret (write-only; shows set/not-set). Gated on
  `VAULT_ENABLED`.
- **Vendor `/access`:** surface `accessMode` on the row; for GATEWAY sites the
  **Open** action posts to the launch endpoint instead of linking to
  `https://<hostname>` directly. Non-gateway sites are unchanged.

## Capability gate

`vaultEnabled()` (`src/lib/vault/enabled.ts`, mirrors
`src/lib/recording/enabled.ts`): reads `VAULT_ENABLED` env now, license later.
When off: the admin vault section is hidden, the launch endpoint returns a
"disabled" response, and GATEWAY Open falls back to the current direct link.

## Error handling

- No vault credential for a GATEWAY site, or `VAULT_ENABLED` off → launch falls
  back to the plain Guacamole URL (vendor logs in manually, as today). Never a
  hard error.
- Grant denied → 403 from the launch endpoint (same as proxy enforcement).
- Guacamole unreachable / token POST fails → clear error to the vendor; the
  decryption + signing never logs the plaintext secret.

## Testing

- **`guac-json` module (pure unit):** given a fixed key + JSON, assert the blob
  round-trips (decrypt with the same key → `sig‖json`, HMAC verifies, JSON
  matches). This proves byte-format correctness offline without a live Guacamole.
- **Vault encrypt-at-rest:** storing a secret persists ciphertext, not plaintext;
  `decrypt` recovers it.
- **Launch guard (pure where possible):** denied grant → no blob built;
  `VAULT_ENABLED` off → disabled path.
- **Gate A (operator, user runs at home):** running gateway with the extension +
  a real RDP/SSH target + browser → clicking Open drops straight into the
  recorded session with no Guacamole login and no password entry.

## Deployment

- Prisma `db push` adds `VaultCredential` + two enums (additive). Per the deploy
  lesson: bump **both** `access-manager` and `access-migrate` to the release and
  run the migrate one-shot.
- Gateway pack change ships in `deploy/gateway/` (operators re-run `setup.sh` to
  get the extension + `JSON_SECRET_KEY`); the manager gets the matching
  `JSON_SECRET_KEY` env.
- Manager image bump; data-plane and connector unchanged.

## Risks (honest)

- **Blob format compatibility** is the top risk — the extension is exact about
  AES-128-CBC + HMAC-SHA256 + zero IV + signature-prepend. Task 1 de-risks this
  against a live Guacamole before anything else is built.
- **Handoff wire** (server-side token vs `?data=`) is spike-determined; the plan
  commits to the proven one.
- **Gate A needs a running gateway**, so final validation is operator-run, not
  headless.
