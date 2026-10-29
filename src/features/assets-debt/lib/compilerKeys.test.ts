/** @jest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "@babel/core";

/**
 * The app builds with the React Compiler, which Jest does not use. The compiler may cache a value computed during
 * render, so a new key made while rendering can be handed back again: an "add" then replaces the item added before it
 * (an Extra payment dialog bug). New keys are made in event handlers; this checks the compiled output of the loan
 * screens for a key cached by the compiler.
 */

const ROOT = join(__dirname, "../components");
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
});

it("no loan screen caches a new key during render", () => {
  const offenders: string[] = [];
  for (const path of files(ROOT)) {
    const source = readFileSync(path, "utf8");
    if (!/\b(simKey|generateId)\(/.test(source)) continue;
    const code = transformSync(source, {
      filename: path, babelrc: false, configFile: false,
      presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
      plugins: [["babel-plugin-react-compiler", {}]],
    })?.code ?? "";
    // A compiler cache slot filled once by a key generator: `if ($[n] === Symbol.for("react.memo_cache_sentinel")) { t = simKey(...)`.
    if (/memo_cache_sentinel"\)\)\s*\{\s*\w+\s*=\s*(simKey|generateId)\(/.test(code)) offenders.push(path.slice(ROOT.length + 1));
  }
  expect(offenders).toEqual([]);
});
