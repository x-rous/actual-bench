import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  /*
   * No em dashes in anything a user reads.
   *
   * A standing rule from the product owner: the UI uses a plain hyphen. This
   * catches the three places the character can reach a screen — JSX text, a
   * string literal (labels, hints, aria-labels, toasts), and a template
   * literal — across the UI trees only. Regex literals are exempt: a character
   * class matching a dash legitimately lists every dash.
   *
   * Comments and docblocks are untouched; ESLint does not visit them, and they
   * are not UI.
   */
  {
    files: ["src/app/**", "src/components/**", "src/features/**"],
    // Test names and fixture banners are not UI.
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/\u2014/]",
          message: "Use a plain hyphen '-' in UI text, never an em dash.",
        },
        {
          selector: "Literal:not([regex])[value=/\u2014/]",
          message: "Use a plain hyphen '-' in UI text, never an em dash.",
        },
        {
          selector: "TemplateElement[value.raw=/\u2014/]",
          message: "Use a plain hyphen '-' in UI text, never an em dash.",
        },
      ],
    },
  },

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