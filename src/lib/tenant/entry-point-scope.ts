import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// True when the first non-empty, non-comment line is the "use client" directive
// (single or double quoted). Client components render on the browser — they
// never touch the server-side tenant scope, so the RSC wrapping invariant does
// not apply to them.
export function isClientComponent(src: string): boolean {
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    return /^["']use client["']/.test(line);
  }
  return false;
}

// True when the source references the named tenant wrapper (import or call) —
// a cheap textual check, not a full parse.
export function referencesWrapper(src: string, name: "withRequestTenant" | "withTenantRoute"): boolean {
  return new RegExp(`\\b${name}\\b`).test(src);
}

// Names of HTTP-method handlers exported as a bare `export [async] function
// NAME` — i.e. NOT routed through `withTenantRoute`. Scanned methods: GET POST
// PUT PATCH DELETE.
export function bareMethodExports(src: string): string[] {
  return METHODS.filter((m) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(src));
}

// Recursive directory walk (no new deps) returning every file path under `dir`
// for which `predicate` is true.
export function listFiles(dir: string, predicate: (path: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (predicate(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function readSrc(path: string): string {
  return readFileSync(path, "utf8");
}
