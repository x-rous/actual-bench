import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Fix: allow require() in config files
  {
    files: ["*.config.*", "*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Override default ignores
  globalIgnores([
    ".next/**",
    ".next-build/**",
    // Build output from the documentation screenshot instance.
    ".next-shots/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "next-env.d.ts",
    "agents/**",
    "docs-site/**",
  ]),
]);

export default eslintConfig;