// Unit-level: proves withTenantFrom is pure pass-through when MULTI_TENANT is
// off — the resolver is never invoked and the handler's response passes
// through unchanged. (Flag-on behavior is proven against a live DB in
// internal.integration.test.ts.) Also proves requireDataplaneSecret is the
// outermost gate: an unauthenticated caller never reaches tenant resolution,
// closing the pre-auth cross-tenant enumeration oracle a resolve-before-auth
// ordering would otherwise open.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mutable so a single test can flip MULTI_TENANT "on" to exercise
// withTenantFrom's resolving path without vi.resetModules() ceremony; every
// other test relies on the default "off" (pass-through, matches self-host).
const { multiTenantFlag } = vi.hoisted(() => ({ multiTenantFlag: { on: false } }));
vi.mock("@/lib/tenant/enabled", () => ({ multiTenantEnabled: () => multiTenantFlag.on }));

const { queryRawUnsafe } = vi.hoisted(() => ({ queryRawUnsafe: vi.fn(async () => [{ id: "tenant-x" }]) }));
vi.mock("@/lib/db", () => ({ base: { $queryRawUnsafe: queryRawUnsafe } }));

import { withTenantFrom, resolveTenantByHostname, requireDataplaneSecret } from "./internal";

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

describe("requireDataplaneSecret", () => {
  const ORIGINAL_SECRET = process.env.DATAPLANE_SECRET;

  beforeEach(() => {
    process.env.DATAPLANE_SECRET = "correct-horse-battery-staple";
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.DATAPLANE_SECRET;
    else process.env.DATAPLANE_SECRET = ORIGINAL_SECRET;
    multiTenantFlag.on = false;
  });

  function req(secret?: string): Request {
    const headers = new Headers();
    if (secret !== undefined) headers.set("x-dataplane-secret", secret);
    return new Request("http://x", { method: "POST", headers });
  }

  it("403s and never calls the handler when the secret header is missing", async () => {
    const handler = vi.fn(async (_req: Request) => new Response("should not run"));
    const wrapped = requireDataplaneSecret(handler);
    const res = await wrapped(req() as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("403s and never calls the handler when the secret header is wrong", async () => {
    const handler = vi.fn(async (_req: Request) => new Response("should not run"));
    const wrapped = requireDataplaneSecret(handler);
    const res = await wrapped(req("wrong-secret") as never);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler and passes its response through when the secret is correct", async () => {
    const handler = vi.fn(async (_req: Request) => new Response("ok"));
    const wrapped = requireDataplaneSecret(handler);
    const res = await wrapped(req("correct-horse-battery-staple") as never);
    expect(await res.text()).toBe("ok");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("composition order: an unauthenticated request never triggers tenant resolution", async () => {
    multiTenantFlag.on = true; // flag on, so withTenantFrom would otherwise resolve
    const resolve = vi.fn(async (_req: Request) => "some-tenant-id");
    const handler = vi.fn(async (_req: Request) => new Response("should not run"));
    const composed = requireDataplaneSecret(withTenantFrom(resolve)(handler));

    const res = await composed(req("wrong-secret") as never);

    expect(res.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
