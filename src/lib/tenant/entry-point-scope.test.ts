import { describe, it, expect } from "vitest";
import { isClientComponent, referencesWrapper, bareMethodExports, listFiles, readSrc } from "./entry-point-scope";

describe("entry-point-scope helpers", () => {
  it("detects a client component", () => {
    expect(isClientComponent(`"use client";\nexport default function X(){}`)).toBe(true);
    expect(isClientComponent(`// a comment\n"use client"\n`)).toBe(true);
    expect(isClientComponent(`export default function X(){}`)).toBe(false);
  });
  it("finds a referenced wrapper", () => {
    expect(referencesWrapper(`import { withRequestTenant } from "@/lib/tenant/request";`, "withRequestTenant")).toBe(true);
    expect(referencesWrapper(`const x = 1;`, "withRequestTenant")).toBe(false);
  });
  it("flags bare method exports, ignores wrapped ones", () => {
    expect(bareMethodExports(`export async function POST(req){}`)).toEqual(["POST"]);
    expect(bareMethodExports(`export function GET(){}\nexport async function DELETE(){}`)).toEqual(["GET", "DELETE"]);
    expect(bareMethodExports(`export const POST = withTenantRoute(async (req) => {});`)).toEqual([]);
  });
});

const RSC_ROOTS = ["src/app/(app)", "src/app/(portal)"];
const isRsc = (p: string) => /(?:page|layout)\.tsx$/.test(p);

describe("RSC entry points are tenant-scoped", () => {
  it("every server page/layout under (app)/(portal) wraps withRequestTenant", () => {
    const offenders: string[] = [];
    for (const root of RSC_ROOTS) {
      for (const file of listFiles(root, isRsc)) {
        const src = readSrc(file);
        if (isClientComponent(src)) continue;
        if (!referencesWrapper(src, "withRequestTenant")) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

const isRoute = (p: string) => /route\.ts$/.test(p);

describe("admin route handlers are tenant-scoped", () => {
  it("every /api/admin route wraps all method exports in withTenantRoute", () => {
    const offenders: string[] = [];
    for (const file of listFiles("src/app/api/admin", isRoute)) {
      const src = readSrc(file);
      const bare = bareMethodExports(src);
      if (bare.length || !referencesWrapper(src, "withTenantRoute")) offenders.push(`${file} [${bare.join(",")}]`);
    }
    expect(offenders).toEqual([]);
  });
});
