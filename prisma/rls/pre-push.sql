-- Runs BEFORE `prisma db push` (migrate entrypoint). Idempotent.
--
-- Every table gains a tenantId column (default 'default') with an FK to Tenant.
-- `db push` backfills existing rows to 'default' and then validates that FK, so
-- the Tenant('default') row must already exist — but db push creates the Tenant
-- table empty in the same pass. This seeds it first so the FK validates.
CREATE TABLE IF NOT EXISTS "Tenant" (
  "id"        text PRIMARY KEY,
  "slug"      text UNIQUE NOT NULL,
  "name"      text NOT NULL,
  "status"    text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "Tenant" ("id", "slug", "name")
VALUES ('default', 'default', 'Default')
ON CONFLICT ("id") DO NOTHING;
