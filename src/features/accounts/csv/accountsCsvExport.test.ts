import type { StagedMap } from "@/types/staged";
import type { Account } from "@/types/entities";
import { exportAccountsToCsv } from "./accountsCsvExport";

const entry = (entity: Account, isDeleted = false) => ({
  entity,
  original: entity,
  isNew: false,
  isUpdated: false,
  isDeleted,
  validationErrors: {},
});

const staged: StagedMap<Account> = {
  a1: entry({ id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" }),
  a2: entry({ id: "a2", name: 'Cash, "wallet"', offBudget: true, closed: false, groupId: null }),
  a3: entry({ id: "a3", name: "Removed", offBudget: false, closed: false, groupId: "g1" }, true),
};

describe("exportAccountsToCsv", () => {
  it("keeps a group name that looks like a formula from running as one", () => {
    const csv = exportAccountsToCsv(
      { a1: entry({ id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" }) },
      [{ id: "g1", name: "=HYPERLINK(\"http://example.com\")" }]
    );
    expect(csv.split("\n")[1]).toBe('a1,Checking,false,false,"\'=HYPERLINK(""http://example.com"")"');
  });

  it("keeps the original four columns when the server has no account groups", () => {
    expect(exportAccountsToCsv(staged).split("\n")[0]).toBe("id,name,offBudget,closed");
  });

  it("adds the group name, empty for ungrouped accounts, and skips deleted rows", () => {
    const csv = exportAccountsToCsv(staged, [{ id: "g1", name: "Everyday, main" }]);
    expect(csv.split("\n")).toEqual([
      "id,name,offBudget,closed,group",
      'a1,Checking,false,false,"Everyday, main"',
      'a2,"Cash, ""wallet""",true,false,',
    ]);
  });
});
