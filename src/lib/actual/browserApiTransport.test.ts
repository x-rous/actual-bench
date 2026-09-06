import { getBrowserApiRuntime } from "./browser/runtime";
import { getTransport } from "./index";
import type { BrowserApiConnection } from "@/store/connection";

/**
 * Direct mode writes to the user's budget through @actual-app/api in the
 * browser. `index.test.ts` covers accounts, budget amounts and ActualQL well;
 * rules, schedules, tags and notes — and the normalisers that stand between raw
 * runtime rows and the app — had never been executed.
 *
 * Two things are being pinned here:
 *  - the shape handed to the runtime on a write (Direct uses snake_case and
 *    minor units where the app uses camelCase and dollars);
 *  - that a malformed row from the runtime is dropped rather than crashing the
 *    page. These reads come back as raw rows, so a null column is a question of
 *    when, not if.
 */

jest.mock("./browser/runtime", () => ({
  ensureBrowserApiBudgetOpen: jest.fn(),
  getBrowserApiRuntime: jest.fn(),
  syncBrowserApiRuntime: jest.fn(),
}));

const mockRuntime = getBrowserApiRuntime as jest.MockedFunction<typeof getBrowserApiRuntime>;

const connection: BrowserApiConnection = {
  id: "conn-1",
  label: "Home",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "pw",
  budgetSyncId: "budget-1",
};

/** Install a runtime stub and hand back the transport plus the stub's jest.fns. */
function withRuntime(api: Record<string, jest.Mock>) {
  mockRuntime.mockResolvedValue(api as never);
  return getTransport(connection);
}

beforeEach(() => {
  mockRuntime.mockReset();
});

describe("rules", () => {
  it("drops rows the runtime returns without an id, keeping the readable ones", async () => {
    const getRules = jest.fn().mockResolvedValue([
      { id: "r1", stage: null, conditionsOp: "and", conditions: [], actions: [] },
      { stage: null, conditionsOp: "and", conditions: [], actions: [] }, // no id
      null,
      "not a row",
    ]);

    const rules = await withRuntime({ getRules }).getRules();

    expect(rules.map((r) => r.id)).toEqual(["r1"]);
  });

  it("sends an update through the runtime with the id folded into the patch", async () => {
    const updateRule = jest.fn().mockResolvedValue(undefined);
    await withRuntime({ updateRule }).updateRule("r1", {
      conditions: [{ field: "amount", op: "is", value: 12.34, type: "number" }],
    } as never);

    expect(updateRule).toHaveBeenCalledTimes(1);
    const sent = updateRule.mock.calls[0][0];
    expect(sent.id).toBe("r1");
    // Dollars in the editor, minor units on the wire.
    expect(JSON.stringify(sent)).toContain("1234");
  });

  it("deletes by id without transforming anything", async () => {
    const deleteRule = jest.fn().mockResolvedValue(undefined);
    await withRuntime({ deleteRule }).deleteRule("r1");
    expect(deleteRule).toHaveBeenCalledWith("r1");
  });
});

describe("schedules", () => {
  it("drops rows without an id rather than surfacing a schedule with no identity", async () => {
    const getSchedules = jest.fn().mockResolvedValue([
      { id: "s1", name: "Rent", date: "2026-01-01", posts_transaction: true },
      { name: "No id", date: "2026-01-01" },
      undefined,
    ]);

    const schedules = await withRuntime({ getSchedules }).getSchedules();
    expect(schedules.map((s) => s.id)).toEqual(["s1"]);
  });

  it("converts the app's schedule shape to the runtime's on create", async () => {
    const createSchedule = jest.fn().mockResolvedValue("s-new");
    const transport = withRuntime({ createSchedule });

    const created = await transport.createSchedule({
      name: "Rent",
      date: "2026-02-01",
      postsTransaction: true,
      payeeId: "p1",
      accountId: "a1",
      amount: -120_000,
    } as never);

    expect(createSchedule).toHaveBeenCalledWith({
      date: "2026-02-01",
      posts_transaction: true,
      payee: "p1",
      account: "a1",
      name: "Rent",
      amount: -120_000,
    });
    // The runtime returns only an id; the transport rebuilds the entity.
    expect(created).toMatchObject({ id: "s-new", name: "Rent", completed: false });
  });

  it("sends null rather than undefined for an unset payee or account", async () => {
    // The runtime writes the column as given; undefined would leave a stale
    // value in place instead of clearing it.
    const createSchedule = jest.fn().mockResolvedValue("s-new");
    await withRuntime({ createSchedule }).createSchedule({
      date: "2026-02-01",
      postsTransaction: false,
    } as never);

    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ payee: null, account: null })
    );
  });

  it("refuses to write a schedule with no date instead of creating a broken one", async () => {
    // A schedule without a date never fires, and the runtime accepts it
    // silently. Failing here is the only place the user finds out.
    const createSchedule = jest.fn();
    await expect(
      withRuntime({ createSchedule }).createSchedule({ postsTransaction: false } as never)
    ).rejects.toThrow(/date is required/i);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("applies the same conversion on update", async () => {
    const updateSchedule = jest.fn().mockResolvedValue(undefined);
    await withRuntime({ updateSchedule }).updateSchedule("s1", {
      date: "2026-03-01",
      postsTransaction: true,
      payeeId: "p2",
    } as never);

    expect(updateSchedule).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ date: "2026-03-01", posts_transaction: true, payee: "p2" })
    );
  });
});

describe("tags", () => {
  it("reads a tag's label from either column name the runtime may use", async () => {
    const getTags = jest.fn().mockResolvedValue([
      { id: "t1", tag: "holiday" },
      { id: "t2", name: "work" },
    ]);

    const tags = await withRuntime({ getTags }).getTags();
    // The runtime calls the column "tag"; the app calls the field "name".
    expect(tags.map((t) => t.name)).toEqual(["holiday", "work"]);
  });

  it("drops a row with neither a label nor an id", async () => {
    const getTags = jest.fn().mockResolvedValue([
      { id: "t1", tag: "holiday" },
      { id: "t2" },
      { tag: "orphan" },
      {},
    ]);

    const tags = await withRuntime({ getTags }).getTags();
    expect(tags.map((t) => t.id)).toEqual(["t1"]);
  });

  it("leaves an absent colour and description unset rather than empty strings", async () => {
    // The runtime reports a missing column as null; the app's Tag treats
    // "no colour" as undefined, and an empty string would render as a colour.
    const getTags = jest.fn().mockResolvedValue([{ id: "t1", tag: "holiday", color: null }]);
    const [tag] = await withRuntime({ getTags }).getTags();
    expect(tag.color).toBeUndefined();
    expect(tag.description).toBeUndefined();
  });
});

describe("notes", () => {
  it("namespaces an account note id, so it cannot collide with a category's", async () => {
    // Notes share one table keyed by id. Writing an account note under the bare
    // account id would overwrite whatever else happens to use that id.
    const updateNote = jest.fn().mockResolvedValue(undefined);
    await withRuntime({ updateNote }).setAccountNote("a1", "check this");
    expect(updateNote).toHaveBeenCalledWith("account-a1", "check this");
  });

  it("namespaces a budget month note by month", async () => {
    const updateNote = jest.fn().mockResolvedValue(undefined);
    await withRuntime({ updateNote }).setBudgetMonthNote("2026-03", "tight month");
    expect(updateNote).toHaveBeenCalledWith("budget-2026-03", "tight month");
  });

  it("writes a category note under its own id, unprefixed", async () => {
    const updateNote = jest.fn().mockResolvedValue(undefined);
    await withRuntime({ updateNote }).setCategoryNote("c1", "groceries only");
    expect(updateNote).toHaveBeenCalledWith("c1", "groceries only");
  });

  it.each([
    ["account", (t: ReturnType<typeof getTransport>) => t.deleteAccountNote("a1"), "account-a1"],
    ["category", (t: ReturnType<typeof getTransport>) => t.deleteCategoryNote("c1"), "c1"],
    ["budget month", (t: ReturnType<typeof getTransport>) => t.deleteBudgetMonthNote("2026-03"), "budget-2026-03"],
  ])("deletes a %s note by writing null, not an empty string", async (_kind, run, id) => {
    // An empty string is a note whose text is empty; null removes it. The
    // difference shows up as a stray note marker on the row.
    const updateNote = jest.fn().mockResolvedValue(undefined);
    await run(withRuntime({ updateNote }));
    expect(updateNote).toHaveBeenCalledWith(id, null);
  });
});
