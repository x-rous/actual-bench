import { fireEvent, render, screen } from "@testing-library/react";
import type { ImportedTextRow } from "@/features/payee-cleanup/lib/ruleCandidates";
import type { Payee, Rule } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import { GeneraliseRuleDialog } from "./GeneraliseRuleDialog";

const CURRENT = [
  "MARKET BOYS PTY LTD Melbourne VI AUS Card xx4534 Value Date: 12/03/2024",
  "MARKET BOYS PTY LTD Melbourne VI AUS Card xx9166 Value Date: 24/12/2024",
  "MARKET BOYS PTY LTD Sydney Value Date: 10/11/2025",
];

// The history is a whole-budget read owned by a TanStack query; this suite is
// about what the dialog does with the answer.
let rows: ImportedTextRow[] = [];
jest.mock("../../payee-cleanup/hooks/useImportedTextIndex", () => ({
  useImportedTextIndex: () => ({
    rows,
    truncated: false,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
}));

const stageUpdate = jest.fn();
const pushUndo = jest.fn();

function staged<T extends { id: string }>(entity: T): StagedMap<T>[string] {
  return {
    entity,
    original: entity,
    isNew: false,
    isUpdated: false,
    isDeleted: false,
    validationErrors: {},
  };
}

let rule: Rule = {
  id: "r1",
  stage: "pre",
  conditionsOp: "and",
  conditions: [{ field: "imported_payee", op: "oneOf", value: CURRENT }],
  actions: [{ field: "payee", op: "set", value: "p-market" }],
};

const payees: StagedMap<Payee> = { "p-market": staged({ id: "p-market", name: "Market Boys" }) };

type StoreState = {
  rules: StagedMap<Rule>;
  payees: StagedMap<Payee>;
  stageUpdate: typeof stageUpdate;
  pushUndo: typeof pushUndo;
};

function state(): StoreState {
  return { rules: { r1: staged(rule) }, payees, stageUpdate, pushUndo };
}

jest.mock("../../../store/staged", () => ({
  useStagedStore: Object.assign(
    (selector: (s: StoreState) => unknown) => selector(state()),
    { getState: () => state() }
  ),
}));

function row(partial: Partial<ImportedTextRow> & { text: string }): ImportedTextRow {
  return {
    field: partial.field ?? "imported_payee",
    text: partial.text,
    payeeId: partial.payeeId ?? null,
    payeeName: partial.payeeName ?? null,
    transactionCount: partial.transactionCount ?? 1,
  };
}

function open(props: Partial<React.ComponentProps<typeof GeneraliseRuleDialog>> = {}) {
  return render(
    <GeneraliseRuleDialog open onOpenChange={jest.fn()} ruleId="r1" {...props} />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  rows = CURRENT.map((text) => row({ text, payeeId: "p-market" }));
  rule = {
    id: "r1",
    stage: "pre",
    conditionsOp: "and",
    conditions: [{ field: "imported_payee", op: "oneOf", value: CURRENT }],
    actions: [{ field: "payee", op: "set", value: "p-market" }],
  };
});

describe("GeneraliseRuleDialog", () => {
  it("shows what the rule matches today and what it would match instead", () => {
    open();

    expect(screen.getByText(/is one of 3 exact strings/)).toBeInTheDocument();
    expect(screen.getByText(CURRENT[0])).toBeInTheDocument();
    expect(
      screen.getAllByText(/contains "MARKET BOYS PTY LTD"/).length
    ).toBeGreaterThan(0);
  });

  it("offers a short list of distinct options, each labelled with the condition it stages", () => {
    open();

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    const labels = options.map((option) => option.closest("label")?.textContent ?? "");
    // Every option reads differently: the dialog once listed the same condition
    // three times, twice under an identical label.
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toContain('contains "MARKET BOYS PTY LTD"');
    expect(labels[0]).toContain("Recommended");
  });

  it("stages the rewrite in place of the exact strings, leaving the rest of the rule alone", () => {
    rule = {
      ...rule,
      conditions: [
        { field: "imported_payee", op: "oneOf", value: CURRENT },
        { field: "amount", op: "isbetween", value: { num1: 1, num2: 2 } },
      ],
    };
    open();

    fireEvent.click(screen.getByRole("button", { name: "Stage this change" }));

    expect(pushUndo).toHaveBeenCalled();
    const [entityType, id, patch] = stageUpdate.mock.calls[0];
    expect(entityType).toBe("rules");
    expect(id).toBe("r1");
    expect(patch.conditions).toEqual([
      { field: "imported_payee", op: "contains", value: "MARKET BOYS PTY LTD", type: "string" },
      { field: "amount", op: "isbetween", value: { num1: 1, num2: 2 } },
    ]);
    // Actions and stage are the author's; only the matching changes.
    expect(patch.actions).toBeUndefined();
    expect(patch.stage).toBeUndefined();
  });

  it("collapses several or'd exact conditions into one", () => {
    rule = {
      ...rule,
      conditionsOp: "or",
      conditions: CURRENT.map((value) => ({ field: "imported_payee", op: "is", value })),
    };
    open();

    fireEvent.click(screen.getByRole("button", { name: "Stage this change" }));

    expect(stageUpdate.mock.calls[0][2].conditions).toHaveLength(1);
  });

  it("stages nothing when the dialog is cancelled", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(stageUpdate).not.toHaveBeenCalled();
    expect(pushUndo).not.toHaveBeenCalled();
  });

  it("will not stage a rewrite that takes another payee's transactions until it is acknowledged", () => {
    rows = [
      ...rows,
      row({
        text: "MARKET BOYS PTY LTD WHOLESALE Brisbane",
        payeeId: "p-wholesale",
        payeeName: "Market Boys Wholesale",
        transactionCount: 6,
      }),
    ];
    open();

    expect(screen.getAllByText(/belonging to another payee/).length).toBeGreaterThan(0);
    const confirm = screen.getByRole("button", { name: "Stage this change" });
    expect(confirm).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText("Accept a rewrite that also matches another payee's transactions")
    );
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(stageUpdate).toHaveBeenCalled();
  });

  it("says so when the rule has nothing left to generalise", () => {
    rule = {
      ...rule,
      conditions: [{ field: "imported_payee", op: "contains", value: "MARKET BOYS" }],
    };
    open();

    expect(screen.getByText(/nothing to generalise/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage this change" })).toBeDisabled();
  });
});
