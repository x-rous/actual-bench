import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/*
 * A second, lint-independent check that the oracle and the engine cannot see
 * each other. ESLint (eslint.config.mjs) is the enforcement; this test keeps
 * the guarantee visible in the test run and catches a disabled lint rule.
 */

const ROOT = resolve(__dirname, "../../..");
const ORACLE = join(ROOT, "src", "test-oracles");
const MODELS = join(ROOT, "src", "lib", "financial-models");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

function specifiers(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(SPECIFIER_RE)].map((m) => m[1]);
}

function resolvesInto(file: string, specifier: string, target: string, alias: string): boolean {
  if (specifier === alias || specifier.startsWith(`${alias}/`)) return true;
  if (!specifier.startsWith(".")) return false;
  const path = resolve(file, "..", specifier);
  return path === target || path.startsWith(target + sep);
}

it("no oracle file imports the production financial models", () => {
  const offenders = sourceFiles(ORACLE).flatMap((file) =>
    specifiers(file)
      .filter((s) => resolvesInto(file, s, MODELS, "@/lib/financial-models"))
      .map((s) => `${relative(ROOT, file)} → ${s}`)
  );
  expect(offenders).toEqual([]);
});

it("no production financial-model file imports the oracle", () => {
  const offenders = sourceFiles(MODELS).flatMap((file) =>
    specifiers(file)
      .filter((s) => resolvesInto(file, s, ORACLE, "@/test-oracles"))
      .map((s) => `${relative(ROOT, file)} → ${s}`)
  );
  expect(offenders).toEqual([]);
});

it("recognises the import forms it guards against", () => {
  const probe = (s: string) => resolvesInto(join(ORACLE, "rd084", "x.ts"), s, MODELS, "@/lib/financial-models");
  expect(probe("@/lib/financial-models")).toBe(true);
  expect(probe("@/lib/financial-models/money/kernel")).toBe(true);
  expect(probe("../../lib/financial-models/money")).toBe(true);
  expect(probe("./rational")).toBe(false);
});
