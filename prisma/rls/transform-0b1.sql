-- Phase 0b-1: reshape the singleton tables in place BEFORE `prisma db push`, so
-- db push (which would otherwise refuse the destructive PK/column drops) sees
-- them already matching and is a no-op. Idempotent + guarded: each block runs
-- only while the old shape is present, and skips safely when a table does not
-- exist yet (fresh install — db push then creates the new shape directly).

-- Config singletons: id ("singleton") PK -> tenantId PK (one row, tenantId='default').
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PlatformSettings','SmtpConfig','OidcConfig','DirectoryConfig','BrandingConfig','SessionPolicy','UpdateCheckConfig'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'id') THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, t || '_pkey');
      EXECUTE format('ALTER TABLE %I DROP COLUMN "id"', t);
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY ("tenantId")', t);
    END IF;
  END LOOP;
END $$;

-- AuditChainState: id ('singleton'|'admin-singleton') -> (tenantId, scope).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'AuditChainState' AND column_name = 'id') THEN
    ALTER TABLE "AuditChainState" ADD COLUMN IF NOT EXISTS "scope" text;
    UPDATE "AuditChainState" SET "scope" = CASE WHEN "id" = 'admin-singleton' THEN 'admin' ELSE 'access' END WHERE "scope" IS NULL;
    ALTER TABLE "AuditChainState" ALTER COLUMN "scope" SET NOT NULL;
    ALTER TABLE "AuditChainState" DROP CONSTRAINT "AuditChainState_pkey";
    ALTER TABLE "AuditChainState" DROP COLUMN "id";
    ALTER TABLE "AuditChainState" ADD PRIMARY KEY ("tenantId", "scope");
  END IF;
END $$;

-- CronRun: job PK -> (tenantId, job). Nested guard so the regclass cast only runs
-- when the table exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'CronRun') THEN
    IF (SELECT array_agg(a.attname ORDER BY a.attname)
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = '"CronRun"'::regclass AND i.indisprimary) = ARRAY['job'] THEN
      ALTER TABLE "CronRun" DROP CONSTRAINT "CronRun_pkey";
      ALTER TABLE "CronRun" ADD PRIMARY KEY ("tenantId", "job");
    END IF;
  END IF;
END $$;
