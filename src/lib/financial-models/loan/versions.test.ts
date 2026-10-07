import { readFileSync } from "node:fs";
import { CURRENT_COMPONENT_VERSIONS, createVersionRegistry, parseComponentVersion } from "./versions";

describe("component version strings", () => {
  it("parses name@revision", () => {
    expect(parseComponentVersion("daycount-act365f@1")).toEqual({ name: "daycount-act365f", revision: 1 });
    expect(parseComponentVersion("loan-daily@12")).toEqual({ name: "loan-daily", revision: 12 });
  });

  it.each(["act365f", "act365f@0", "act365f@1.1", "Act365F@1", "act365f@", "@1", "a--b@1"])("rejects %j", (bad) => {
    expect(parseComponentVersion(bad)).toBeNull();
  });

  it("names every current component with its own version", () => {
    for (const [name, version] of Object.entries(CURRENT_COMPONENT_VERSIONS)) {
      expect(parseComponentVersion(version)?.name).toBe(name);
    }
  });

  it("keeps the engine reference docs aligned with the current contracts", () => {
    const architecture = readFileSync("docs/assets-debt/engine-architecture.md", "utf8");
    const kernel = readFileSync("docs/assets-debt/engine-kernel.md", "utf8");
    expect(architecture).toContain("loan-daily@8");
    expect(architecture).toContain("event-order@3");
    expect(architecture).toContain("schema version 2");
    expect(architecture).toContain("offsetStates");
    expect(kernel).toContain("versions 1, 2 and 3");
    expect(kernel).toContain("businessDays");
    expect(kernel).toContain("lenderStatement");
    expect(kernel).toContain("event-order@3");
  });
});

describe("version registry", () => {
  it("resolves every registered version by id, old ones included", () => {
    const registry = createVersionRegistry<(x: number) => number>("demo");
    registry.register("demo@1", (x) => x + 1);
    registry.register("demo@2", (x) => x + 2);

    const v1 = registry.resolve("demo@1");
    const v2 = registry.resolve("demo@2");
    expect(v1.ok && v1.impl(10)).toBe(11);
    expect(v2.ok && v2.impl(10)).toBe(12);
    expect(registry.versions()).toEqual(["demo@1", "demo@2"]);
    expect(registry.latest()).toBe("demo@2");
  });

  it("returns a blocking result for an unknown version instead of falling back", () => {
    const registry = createVersionRegistry<number>("demo");
    registry.register("demo@1", 1);
    expect(registry.resolve("demo@3")).toEqual({ ok: false, code: "unsupported-engine-version", version: "demo@3" });
    expect(registry.resolve("other@1")).toEqual({ ok: false, code: "unsupported-engine-version", version: "other@1" });
  });

  it("never lets a version be replaced or registered under another name", () => {
    const registry = createVersionRegistry<number>("demo");
    registry.register("demo@1", 1);
    expect(() => registry.register("demo@1", 2)).toThrow(/already registered/);
    expect(() => registry.register("other@1" as `${string}@${number}`, 1)).toThrow(RangeError);
    expect(() => createVersionRegistry<number>("empty").latest()).toThrow(RangeError);
  });
});
