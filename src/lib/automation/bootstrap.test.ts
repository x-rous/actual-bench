import { ensureAutomationJobTypesRegistered } from "./bootstrap";
import {
  __resetAutomationRegistryForTests,
  getAutomationJobType,
  listAutomationJobTypes,
  registerAutomationJobType,
} from "./registry";

/**
 * Registration has to survive being asked twice.
 *
 * Every entry point calls the bootstrap - routes, the engine tick, the startup
 * hook - because none of them can know whether another already has. It used to
 * be guarded by a boolean per job-type module, which lives in a different module
 * from the registry map: a dev server replacing one and not the other left the
 * flag saying "not registered" while the map already held the type, and the
 * next call threw "already registered" into every Automations page.
 */
describe("registering the built-in job types", () => {
  beforeEach(() => {
    __resetAutomationRegistryForTests();
  });

  it("registers every type Bench can run", () => {
    ensureAutomationJobTypesRegistered();

    expect(listAutomationJobTypes().map((jobType) => jobType.type).sort()).toEqual([
      "backup",
      "backup-scrub",
      "bank-sync",
      "budget-file-sync",
    ]);
  });

  it("can be called repeatedly, which is how it is actually used", () => {
    ensureAutomationJobTypesRegistered();
    ensureAutomationJobTypesRegistered();
    ensureAutomationJobTypesRegistered();

    expect(listAutomationJobTypes()).toHaveLength(4);
  });

  it("survives the registry being replaced underneath it", () => {
    // What a hot reload does: the map is new, the modules that filled it are
    // not. Guarding on a module-level flag made this throw.
    ensureAutomationJobTypesRegistered();
    __resetAutomationRegistryForTests();

    expect(() => ensureAutomationJobTypesRegistered()).not.toThrow();
    expect(getAutomationJobType("backup")).toBeDefined();
  });

  it("still refuses two different implementations of one identifier", () => {
    // The check that made the throw worth having: two features claiming one
    // name would make stored runs ambiguous.
    ensureAutomationJobTypesRegistered();

    expect(() =>
      registerAutomationJobType({
        type: "backup",
        label: "Something else entirely",
        validateConfig: () => ({}),
        run: async () => ({}),
        summarize: () => ({ outcome: "ok" as const, itemCount: 0 }),
        serializeResult: () => ({ version: 1, data: {} }),
      })
    ).toThrow(/already registered/);
  });
});
