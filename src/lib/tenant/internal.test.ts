// Unit-level: proves withTenantFrom is pure pass-through when MULTI_TENANT is
// off — the resolver is never invoked and the handler's response passes
// through unchanged. (Flag-on behavior is proven against a live DB in
// internal.integration.test.ts.)
import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/tenant/enabled", () => ({ multiTenantEnabled: () => false }));

const { queryRawUnsafe } = vi.hoisted(() => ({ queryRawUnsafe: vi.fn(async () => [{ id: "tenant-x" }]) }));
vi.mock("@/lib/db", () => ({ base: { $queryRawUnsafe: queryRawUnsafe } }));

import { withTenantFrom, resolveTenantByHostname } from "./internal";

describe("withTenantFrom", () => {
  it("flag off: pass-through, resolver not called", async () => {
    const resolve = vi.fn();
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withTenantFrom(resolve as never);
    const res = await wrapped(handler)(new Request("http://x") as never);
    expect(await res.text()).toBe("ok");
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("resolveTenantByHostname", () => {
  it("interpolates only the fixed function name; the host is a bound param, lowercased+trimmed", async () => {
    const id = await resolveTenantByHostname("  Example.COM  ");
    expect(queryRawUnsafe).toHaveBeenCalledWith("SELECT resolve_tenant_by_hostname($1) AS id", "example.com");
    expect(id).toBe("tenant-x");
  });
});
