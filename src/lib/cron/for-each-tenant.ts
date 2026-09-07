import { withTenant } from "@/lib/tenant/scope";
import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { listActiveTenantIds } from "@/lib/tenant/internal";

// Fans a cron job out across every ACTIVE tenant in cloud mode, scoping each
// invocation with withTenant (RLS + insert-trigger, same as a request). Self
// -host (flag off): runs the job exactly once, under the implicit default
// scope — byte-identical to the pre-multi-tenant behavior.
export async function forEachTenant<T>(job: () => Promise<T>): Promise<T[]> {
  if (!multiTenantEnabled()) return [await job()];
  const ids = await listActiveTenantIds();
  const out: T[] = [];
  for (const t of ids) out.push(await withTenant(t, job));
  return out;
}
