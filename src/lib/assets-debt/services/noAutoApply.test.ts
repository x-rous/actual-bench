import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Nothing is written to Actual without the user's explicit Apply (SC-018). Static: who may reach the write paths, and
 * that none of them runs from an effect, a timer or a background job.
 */

const ROOT = join(__dirname, "../../../..");
const SRC = join(ROOT, "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !path.includes(`${join("assets-debt", "testing")}`) ? [path] : [];
  });
}
const files = sources(SRC).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));
const importers = (pattern: RegExp) => files.filter((f) => pattern.test(f.text)).map((f) => f.path).sort();

describe("loan tracking writes run only from the user's Apply", () => {
  it("only the write runner calls the executor, and only the tracking tabs call the runner, never from an effect or timer", () => {
    expect(importers(/\bexecuteOutput\(/)).toEqual(["src/features/assets-debt/lib/trackingWrites.ts", "src/lib/assets-debt/services/applyService.ts"]);
    expect(importers(/\bapplyProposals\(/)).toEqual(["src/features/assets-debt/components/loan/TrackingTabs.tsx", "src/features/assets-debt/lib/trackingWrites.ts"]);
    for (const path of ["src/features/assets-debt/lib/trackingWrites.ts", "src/features/assets-debt/components/loan/TrackingTabs.tsx"]) {
      const text = files.find((f) => f.path === path)!.text;
      expect({ path, effect: /useEffect|setInterval|setTimeout|automation/.test(text) }).toEqual({ path, effect: false });
    }
  });
});

describe("no auto-apply (SC-018)", () => {
  it("only the tracking tabs import the write runner at runtime; elsewhere it is a type import", () => {
    const runtime = files.filter((f) => /^import \{[^}]*\} from ["'][^"']*\/trackingWrites["']/m.test(f.text)).map((f) => f.path);
    expect(runtime).toEqual(["src/features/assets-debt/components/loan/TrackingTabs.tsx"]);
    expect(importers(/from ["'][^"']*services\/applyService["']/)).toEqual(["src/features/assets-debt/lib/trackingWrites.ts"]);
  });

  it("no background job or server code reaches the write paths", () => {
    expect(importers(/trackingWrites|services\/applyService|transactionStructure/).filter((p) => p.includes("/automation/") || p.startsWith("src/app/api/"))).toEqual([]);
  });
});
