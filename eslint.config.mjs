import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Guard against the misplaced-hook class of bug (e.g. calling useRouter()
    // inside an event handler): a Rules-of-Hooks violation is valid
    // TypeScript, so only this lint rule catches it before it ships.
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // Both read a persisted value (schedule state / a saved view preference)
    // once after mount and setState — deliberately post-hydration to avoid an
    // SSR mismatch, which is exactly what this rule flags.
    files: [
      "src/app/(app)/access/schedule-builder.tsx",
      "src/app/(app)/admin/sites/sites-view.tsx",
      "src/app/(app)/access/access-view.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
