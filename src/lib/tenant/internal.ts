import { NextResponse } from "next/server";
import { base } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import { multiTenantEnabled } from "@/lib/tenant/enabled";

// Resolvers for non-request contexts (data-plane internal API, connector
// enrollment, cron): each maps a payload key to its tenant id via the matching
// SECURITY DEFINER function (RLS-bypass), mirroring resolveTenantBySlug in
// resolve.ts. `fn` is always one of the fixed internal function names below —
// never derived from user input — so the interpolation is safe; the key is
// always a bound $1 param.
async function callResolver(fn: string, key: string): Promise<string | null> {
  const rows = await base.$queryRawUnsafe<{ id: string | null }[]>(`SELECT ${fn}($1) AS id`, key);
  return rows[0]?.id ?? null;
}

export const resolveTenantByUser = (id: string) => callResolver("resolve_tenant_by_user", id);
export const resolveTenantBySite = (id: string) => callResolver("resolve_tenant_by_site", id);
export const resolveTenantBySessionToken = (h: string) => callResolver("resolve_tenant_by_session_token", h);
export const resolveTenantByRecordingKey = (k: string) => callResolver("resolve_tenant_by_recording_key", k);
export const resolveTenantByConnector = (id: string) => callResolver("resolve_tenant_by_connector", id);
// Hostnames are stored/matched lowercased+trimmed (mirrors resolveTenantByHostname in resolve.ts).
export const resolveTenantByHostname = (host: string) => callResolver("resolve_tenant_by_hostname", host.toLowerCase().trim());

// Enumerates ACTIVE tenants (excluding the reserved 'platform' tenant) via the
// SECURITY DEFINER function, for cron/fan-out contexts with no request tenant.
export async function listActiveTenantIds(): Promise<string[]> {
  const rows = await base.$queryRawUnsafe<{ list_active_tenant_ids: string }[]>(`SELECT list_active_tenant_ids()`);
  return rows.map((r) => r.list_active_tenant_ids);
}

// Wraps a non-request route handler (cron, webhook, connector callback — any
// handler whose tenant isn't the ambient request host) to run under the
// tenant resolved from its own payload/args via `resolve`. Flag off: pass
// -through, unchanged behavior, `resolve` is never called. Flag on: resolve
// the tenant; an unresolvable key 404s as unknown_tenant rather than running
// unscoped; otherwise the handler runs inside withTenant(tid, ...).
export function withTenantFrom<A extends unknown[]>(resolve: (...a: A) => Promise<string | null>) {
  return (handler: (...a: A) => Promise<Response>) =>
    async (...a: A): Promise<Response> => {
      if (!multiTenantEnabled()) return handler(...a);
      const tid = await resolve(...a);
      if (!tid) return NextResponse.json({ error: "unknown_tenant" }, { status: 404 });
      return withTenant(tid, () => handler(...a));
    };
}
