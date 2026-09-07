import { base } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import { createInvite } from "@/lib/auth/invite";
import { isValidTenantSlug } from "@/lib/tenant/constants";

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
    // Unique-violation on slug/id → a friendly conflict.
    throw new PlatformError("slug_taken", (e as Error).message);
  }

  // 2. Provision the first admin: an invite IN THE NEW TENANT, via the existing
  // invite machinery under the new tenant's scope (the insert trigger stamps
  // tenantId; RLS WITH CHECK passes). createdById is null (system-provisioned).
  const { token } = await withTenant(id, () =>
    createInvite({ email: input.adminEmail, name: input.adminEmail, role: "ADMIN", createdById: null }),
  );

  return { tenant: { id, slug, name }, inviteToken: token };
}
