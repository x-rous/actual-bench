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
        /*
         * One dropdown across the app: `Select` (src/components/ui/select.tsx),
         * or `SearchableCombobox` / `BudgetSelect` for long lists worth
         * searching. A raw <select> looks and behaves differently from both.
         */
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Use Select from @/components/ui/select (or SearchableCombobox / BudgetSelect for long, searchable lists), not a raw <select>.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='checkbox']",
          message: "Use Checkbox from @/components/ui/checkbox, not a raw checkbox <input>.",
        },
        /*
         * Text fields: `Input` (or `SearchInput`, `Textarea`). Radio, file,
         * colour and hidden inputs have no styled equivalent and stay native.
         * The few deliberate exceptions (editors inside table cells, the
         * search box inside a dropdown) carry a disable comment saying why.
         */
        {
          selector:
            "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value=/^(checkbox|radio|file|color|hidden)$/]))",
          message:
            "Use Input from @/components/ui/input (or SearchInput for a search box), not a raw <input>.",
        },
        {
          selector: "JSXAttribute[name.name='type'][value.value='date']",
          message:
            "Use DateInput from @/components/ui/date-input: dates are typed in the budget's format, as in Actual.",
        },
        {
          selector: "JSXOpeningElement[name.name='textarea']",
          message: "Use Textarea from @/components/ui/textarea, not a raw <textarea>.",
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
    // PDF.js support files, copied from pdfjs-dist at install time.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;