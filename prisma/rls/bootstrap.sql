-- Phase 0b-2: install the tenant-isolation RLS layer. Runs AFTER `db push`
-- (tables exist), idempotent. DORMANT on self-host: the app connects as the
-- table owner, which bypasses RLS; the `app` role + GUC are used only once
-- multi-tenant is activated (Phase 2). We never FORCE ROW LEVEL SECURITY (that
-- would trap the owner too). `app_password` is passed via `psql -v`.

-- 1. Non-owner application role (only when a password is supplied and it is absent).
SELECT (NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app')) AND :'app_password' <> '' AS need_role \gset
\if :need_role
CREATE ROLE app LOGIN PASSWORD :'app_password';
\endif

-- 2. Grants (only if the role exists).
SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') AS have_role \gset
\if :have_role
GRANT USAGE ON SCHEMA public TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
\endif

-- 3. Enable RLS + the tenant_isolation policy on every table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Passkey','TotpSecret','Invite','Session','Connector','ConnectorPairing',
    'Site','VaultCredential','AccessGrant','AuditEvent','AuditChainState','AuditAnchor',
    'AdminAuditAnchor','SmtpConfig','BrandingConfig','Notification','OidcConfig',
    'DirectoryConfig','GroupMapping','SessionPolicy','CronRun','PlatformSettings',
    'UpdateCheckConfig','SessionRecording','RecordingChunk','SessionKeyEvent','AdminAuditEvent'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', true))',
      t);
  END LOOP;

  -- Tenant is keyed by id (a tenant sees only its own row).
  EXECUTE 'ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "Tenant"';
  EXECUTE 'CREATE POLICY tenant_isolation ON "Tenant" USING ("id" = current_setting(''app.current_tenant'', true)) WITH CHECK ("id" = current_setting(''app.current_tenant'', true))';
END $$;
