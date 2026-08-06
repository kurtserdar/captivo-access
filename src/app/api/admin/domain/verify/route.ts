import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/auth/roles";
import { accessDomain, wildcardRecord, classifyVerify } from "@/lib/domain/custom-domain";

export const dynamic = "force-dynamic";

async function resolve4(host: string): Promise<string[]> {
  try {
    return await dns.resolve4(host);
  } catch {
    return [];
  }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(user.role, "configure")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const domain = accessDomain(process.env.MANAGER_PUBLIC_URL, process.env.ACCESS_DOMAIN);
  if (!domain) return NextResponse.json({ status: "undetermined", reason: "no_domain" });

  // Expected server IP = the A record of the manager's own hostname.
  const expected = await resolve4(`manager.${domain}`);
  if (expected.length === 0) {
    return NextResponse.json({ status: "undetermined", reason: "manager_unresolved", record: wildcardRecord(domain) });
  }
  const expectedIp = expected[0];

  // Probe a throwaway label to test the wildcard record — no real Site needed,
  // and the unique label avoids any resolver cache.
  const probe = `wildcard-check-${Date.now().toString(36)}.${domain}`;
  const resolved = await resolve4(probe);

  return NextResponse.json({
    status: classifyVerify(expectedIp, resolved),
    record: wildcardRecord(domain),
    expectedIp,
    resolvedIp: resolved[0] ?? null,
  });
}
