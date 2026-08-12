# Admin-Action Audit — Config Wave (2nd Wave) — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Slice:** Extend the admin-action audit trail to configuration/settings changes, reusing the wave-1 infrastructure. No new model, helper, or UI.

## Problem

Wave 1 (v0.36.0) records security-critical mutations (grants, sessions, users, invites, connectors, resources) into `AdminAuditEvent` via `recordAdminAction()`, shown on `/admin/audit?tab=admin`. Configuration changes — SMTP, SSO, platform/session policy, directory, connector operational config, and recording deletion — are still unaudited. This wave instruments them.

## Scope

- **In:** instrument the config/operational mutation routes below with `recordAdminAction()`; add their `adminActionLabel` entries (+ test).
- **Out:** any new model/helper/UI (all reused from wave 1); read-only/test routes (`smtp/test`, `sso/test`, `directory/test`, `directory/resolve-preview`, `updates/check`, `domain/verify` — DNS-check only, no DB write); notifications mark-as-read (not security-relevant); tamper-evidence (separate hardening).
- **English-only. No schema change.** Deploy = **manager only** (no data-plane/connector/migrate change).

## Metadata policy (the key constraint)

**Never write configuration values into the audit — action + a safe fixed summary only, no `metadata` of config fields.** SMTP, SSO, and directory configs hold encrypted secrets (SMTP password, OIDC client secret, LDAP bind password); a field-level diff risks leaking them and needs per-config field curation. The audit's value here is accountability ("admin X changed SMTP settings at time T"), not a field diff. So each call passes only `action`, a hardcoded `summary` (e.g. `"Updated SMTP settings"`), `targetType`/`targetId` where a target id exists (connector/recording), and `clientIp` — **no `metadata`**.

## Instrumented routes + actions

| Route (method) | action | target |
|---|---|---|
| `api/admin/smtp/route.ts` (POST) | `config.smtp_update` | — |
| `api/admin/sso/route.ts` (POST) | `config.sso_update` | — |
| `api/admin/policy/platform/route.ts` (POST) | `config.platform_update` | — |
| `api/admin/policy/session/route.ts` (POST) | `config.session_policy_update` | — |
| `api/admin/policy/connector-log-level/reset-all/route.ts` (POST) | `config.log_level_reset` | — |
| `api/admin/directory/route.ts` (POST) | `config.directory_update` | — |
| `api/admin/directory/mappings/route.ts` (POST) | `config.directory_mapping_create` | mapping / new id |
| `api/admin/directory/mappings/[id]/route.ts` (PATCH) | `config.directory_mapping_update` | mapping / `id` |
| `api/admin/directory/mappings/[id]/route.ts` (DELETE) | `config.directory_mapping_delete` | mapping / `id` |
| `api/admin/updates/route.ts` (POST) | `config.updates_update` | — |
| `api/admin/connectors/[id]/egress-policy/route.ts` (POST) | `connector.egress_update` | connector / `id` |
| `api/admin/connectors/[id]/log-level/route.ts` (POST) | `connector.log_level` | connector / `id` |
| `api/admin/connectors/[id]/repair/route.ts` (POST) | `connector.repair` | connector / `id` |
| `api/admin/recordings/[id]/route.ts` (DELETE) | `recording.delete` | recording / `id` |

Each: import `recordAdminAction` + `clientIp`, and after the existing **success** path (before the success response), call with the route's `admin` actor (`getCurrentUser()`/`requireUser()`) and `clientIp(req.headers) ?? null`. Rename any `_req`→`req` where headers are needed. Only the success branch is instrumented.

## Labels

Add to `src/lib/audit/admin-actions.ts` `LABELS`:
`config.smtp_update → "SMTP settings updated"`, `config.sso_update → "SSO settings updated"`, `config.platform_update → "Platform settings updated"`, `config.session_policy_update → "Session policy updated"`, `config.log_level_reset → "Connector log level reset"`, `config.directory_update → "Directory settings updated"`, `config.directory_mapping_create → "Directory mapping created"`, `config.directory_mapping_update → "Directory mapping updated"`, `config.directory_mapping_delete → "Directory mapping deleted"`, `config.updates_update → "Update settings updated"`, `connector.egress_update → "Connector egress policy updated"`, `connector.log_level → "Connector log level set"`, `connector.repair → "Connector repaired"`, `recording.delete → "Recording deleted"`.

## Testing

- **Unit** (`vitest`): extend `src/lib/audit/admin-actions.test.ts` with one new label assertion (e.g. `config.smtp_update → "SMTP settings updated"`) — the fallback case already exists.
- **Build gate:** `pnpm build`.
- **Manual (Gate A):** change SMTP settings, session policy, a directory mapping, repair a connector, delete a recording → each appears on `/admin/audit?tab=admin` with the right action/summary and **no secret values** anywhere in the row; a forbidden attempt records nothing.

## Out of scope (backlog)

- Field-level config diffs (would require per-config secret-field curation).
- Tamper-evidence (hash-chain + anchor) for the admin log.
- Custom-domain change auditing (no dedicated mutation route exists — `domain/verify` is a read-only check).
