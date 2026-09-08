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

-- 4. Write-side stamping. Prisma's @default("default") sends tenantId="default"
-- explicitly on INSERT, bypassing any column default. This BEFORE INSERT trigger
-- replaces that sentinel with the request's tenant GUC (deterministic,
-- connection-bound — no dependency on app-level ALS). Self-host: GUC unset ⇒
-- no-op, tenantId stays "default". An explicit non-default tenantId is left
-- alone and validated by the RLS WITH CHECK.
CREATE OR REPLACE FUNCTION set_tenant_from_guc() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.current_tenant', true) IS NOT NULL
     AND current_setting('app.current_tenant', true) <> ''
     AND NEW."tenantId" = 'default' THEN
    NEW."tenantId" := current_setting('app.current_tenant', true);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

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
    EXECUTE format('DROP TRIGGER IF EXISTS trg_tenant_from_guc ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_tenant_from_guc BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION set_tenant_from_guc()', t);
  END LOOP;
END $$;

-- 5. SECURITY DEFINER resolvers (Phase 2b). Owner-defined so they bypass RLS —
-- the app role has no tenant scope yet when resolving a request's tenant from
-- its host. Read-only, STABLE, search_path pinned; EXECUTE granted only to app.
CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT id FROM "Tenant" WHERE slug = p_slug AND status = 'ACTIVE'
$$;
CREATE OR REPLACE FUNCTION resolve_tenant_by_hostname(p_host text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT "tenantId" FROM "Site" WHERE hostname = p_host LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_tenant_by_hostname(text) FROM PUBLIC;

SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') AS have_role \gset
\if :have_role
GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO app;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_hostname(text) TO app;
\endif

-- 6. Platform control-plane functions (cross-tenant, RLS-bypass). Owner-defined
-- so a platform admin — whose session is RLS-scoped to the reserved 'platform'
-- tenant — can manage OTHER tenants. Authorization is app-level
-- (requirePlatformAdmin); these do the RLS-bypass mechanics only.
CREATE OR REPLACE FUNCTION platform_create_tenant(p_id text, p_slug text, p_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO "Tenant"(id, slug, name, status) VALUES (p_id, p_slug, p_name, 'ACTIVE');
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION platform_list_tenants()
RETURNS TABLE(id text, slug text, name text, status text, "createdAt" timestamptz, "adminCount" bigint)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT t.id, t.slug, t.name, t.status, t."createdAt",
         (SELECT count(*) FROM "User" u WHERE u."tenantId" = t.id) AS "adminCount"
  FROM "Tenant" t
  WHERE t.id NOT IN ('platform', 'default')
  ORDER BY t."createdAt" DESC
$$;

CREATE OR REPLACE FUNCTION platform_set_tenant_status(p_id text, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'invalid tenant status: %', p_status;
  END IF;
  IF p_id = 'platform' THEN
    RAISE EXCEPTION 'cannot change the platform tenant status';
  END IF;
  UPDATE "Tenant" SET status = p_status WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION platform_create_tenant(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_list_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_set_tenant_status(text, text) FROM PUBLIC;

SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') AS have_role \gset
\if :have_role
GRANT EXECUTE ON FUNCTION platform_create_tenant(text, text, text) TO app;
GRANT EXECUTE ON FUNCTION platform_list_tenants() TO app;
GRANT EXECUTE ON FUNCTION platform_set_tenant_status(text, text) TO app;
\endif

-- 7. Additional resolvers for non-request contexts (data-plane internal API,
-- connector enrollment, cron). Owner-defined RLS-bypass, like section 5.
CREATE OR REPLACE FUNCTION resolve_tenant_by_user(p_id text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT "tenantId" FROM "User" WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION resolve_tenant_by_site(p_id text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT "tenantId" FROM "Site" WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION resolve_tenant_by_session_token(p_hash text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT "tenantId" FROM "Session" WHERE "tokenHash" = p_hash $$;
CREATE OR REPLACE FUNCTION resolve_tenant_by_recording_key(p_key text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT "tenantId" FROM "SessionRecording" WHERE "recordingKey" = p_key $$;
CREATE OR REPLACE FUNCTION resolve_tenant_by_connector(p_id text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT "tenantId" FROM "Connector" WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION list_active_tenant_ids()
RETURNS SETOF text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT id FROM "Tenant" WHERE status = 'ACTIVE' AND id NOT IN ('platform', 'default') $$;

CREATE OR REPLACE FUNCTION list_connector_token_candidates()
RETURNS TABLE(id text, "tenantId" text, "tokenHash" text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT id, "tenantId", "tokenHash" FROM "Connector" $$;
CREATE OR REPLACE FUNCTION list_pairing_candidates()
RETURNS TABLE(id text, "tenantId" text, "codeHash" text, "expiresAt" timestamptz, "usedAt" timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT id, "tenantId", "codeHash", "expiresAt", "usedAt" FROM "ConnectorPairing" $$;

REVOKE ALL ON FUNCTION resolve_tenant_by_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_tenant_by_site(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_tenant_by_session_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_tenant_by_recording_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_tenant_by_connector(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_active_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_connector_token_candidates() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_pairing_candidates() FROM PUBLIC;

SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') AS have_role \gset
\if :have_role
GRANT EXECUTE ON FUNCTION resolve_tenant_by_user(text) TO app;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_site(text) TO app;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_session_token(text) TO app;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_recording_key(text) TO app;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_connector(text) TO app;
GRANT EXECUTE ON FUNCTION list_active_tenant_ids() TO app;
GRANT EXECUTE ON FUNCTION list_connector_token_candidates() TO app;
GRANT EXECUTE ON FUNCTION list_pairing_candidates() TO app;
\endif

-- 8. Custom (BYO) vendor hostnames must be globally unique (managed hosts are
-- per-tenant-unique via the slug suffix; only customDomain hosts need this).
CREATE UNIQUE INDEX IF NOT EXISTS site_custom_hostname_uq ON "Site" (hostname) WHERE "customDomain";
