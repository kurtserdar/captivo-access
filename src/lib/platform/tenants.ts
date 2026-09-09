import { base } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import { createInvite } from "@/lib/auth/invite";
import { isValidTenantSlug } from "@/lib/tenant/constants";
import { consoleDomain } from "@/lib/tenant/console-domain";

export class PlatformError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "PlatformError";
  }
}

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
  adminCount: number;
}

// Minimal email sanity check (the invite is the real proof of address).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCreateInput(input: { name: string; slug: string; adminEmail: string }) {
  if (!input.name.trim()) throw new PlatformError("invalid_name");
  if (!isValidTenantSlug(input.slug)) throw new PlatformError("invalid_slug");
  if (!EMAIL_RE.test(input.adminEmail.trim())) throw new PlatformError("invalid_email");
}

// Confirmed empirically against Prisma 7.9 + the pg driver adapter: a Postgres
// unique-violation (SQLSTATE 23505) raised inside a raw query surfaces as a
// PrismaClientKnownRequestError with code "P2010" (generic "raw query failed"),
// and the actual SQLSTATE is nested at meta.driverAdapterError.cause.originalCode
// (meta.code is NOT the SQLSTATE on this client — don't rely on it). Any other
// error (connection failure, pool exhaustion, permission/grant regression,
// etc.) must propagate unchanged so it isn't misreported as "slug taken".
function isUniqueViolation(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const err = e as {
    code?: string;
    meta?: { driverAdapterError?: { cause?: { originalCode?: string; kind?: string } } };
  };
  return err.code === "P2010" && err.meta?.driverAdapterError?.cause?.originalCode === "23505";
}

export async function listTenants(): Promise<PlatformTenant[]> {
  const rows = await base.$queryRawUnsafe<
    { id: string; slug: string; name: string; status: string; createdAt: Date; adminCount: bigint }[]
  >(`SELECT * FROM platform_list_tenants()`);
  return rows.map((r) => ({ ...r, adminCount: Number(r.adminCount) }));
}

export async function setTenantStatus(id: string, status: "ACTIVE" | "SUSPENDED"): Promise<void> {
  // The SQL function returns void; $queryRawUnsafe can't deserialize a void
  // column (Prisma 7), so this must be $executeRawUnsafe.
  await base.$executeRawUnsafe(`SELECT platform_set_tenant_status($1, $2)`, id, status);
}

export async function createTenant(input: { name: string; slug: string; adminEmail: string }) {
  validateCreateInput(input);
  const id = crypto.randomUUID();
  const name = input.name.trim();
  const slug = input.slug;

  // 1. Create the Tenant row via the RLS-bypass function (unscoped, as owner-defined).
  try {
    await base.$queryRawUnsafe(`SELECT platform_create_tenant($1, $2, $3)`, id, slug, name);
  } catch (e) {
    // A genuine unique-violation on slug/id → a friendly conflict. Everything
    // else (DB outage, pool exhaustion, a grant regression, ...) propagates
    // unchanged — it must never be masked as "slug taken".
    if (isUniqueViolation(e)) throw new PlatformError("slug_taken", (e as Error).message);
    throw e;
  }

  // 2. Provision the first admin: an invite IN THE NEW TENANT, via the existing
  // invite machinery under the new tenant's scope (the insert trigger stamps
  // tenantId; RLS WITH CHECK passes). createdById is null (system-provisioned).
  const { token } = await withTenant(id, () =>
    createInvite({ email: input.adminEmail, name: input.adminEmail, role: "ADMIN", createdById: null }),
  );

  // The first admin accepts the invite at the tenant's own console host,
  // <slug>.<consoleDomain>. Prefer CONSOLE_DOMAIN; fall back to the access domain.
  const domain = consoleDomain() ?? "";
  const inviteUrl = domain
    ? `https://${slug}.${domain}/invite/${token}`
    : `/invite/${token}`;

  return { tenant: { id, slug, name }, inviteToken: token, inviteUrl };
}
