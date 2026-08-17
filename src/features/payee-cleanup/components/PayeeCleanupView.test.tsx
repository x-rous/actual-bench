import { fireEvent, render, screen, within } from "@testing-library/react";
import { PayeeCleanupView } from "./PayeeCleanupView";
import { partitionByEligibility } from "../lib/eligibility";
import { getPayeeCleanupCapabilities } from "../lib/capabilities";
import type { PayeeCleanupCandidate } from "../types";

function payee(
  name: string,
  overrides: Partial<PayeeCleanupCandidate["metadata"]> = {}
): PayeeCleanupCandidate {
  const id = `p-${name}`;
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
      ...overrides,
    },
  };
}

let candidates: PayeeCleanupCandidate[] = [];
let stagedRules: Record<string, unknown> = {};
let transactionCounts: Map<string, number> | undefined = new Map();
let transactionsLoading = false;
let mode: "http-api" | "browser-api" = "http-api";
let isLoading = false;

// The impact hook owns the TanStack queries (rules, schedules, transaction
// counts); this suite is about what the view renders, so it supplies the loaded
// shape directly rather than standing up a QueryClientProvider.
jest.mock("../hooks/usePayeeCleanupImpact", () => ({
  usePayeeCleanupImpact: () => ({
    stagedRules,
    schedules: [],
    transactionCounts,
    transactionsLoading,
  }),
}));

// Suppression persistence is exercised in its own suites (the repository and
// lib/suppressions); here the view just needs the calls recorded.
let importedText: { field: "imported_payee" | "notes"; text: string; payeeId: string | null; transactionCount: number }[] = [];
jest.mock("../hooks/useImportedTextIndex", () => ({
  useImportedTextIndex: () => ({ rows: importedText, isLoading: false }),
}));

const toastSuccess = jest.fn();
jest.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m) } }));

const rejectCluster = jest.fn();
const rejectRuleGap = jest.fn();
const stageMock = jest.fn();
jest.mock("../hooks/usePayeeCleanupPlan", () => ({
  usePayeeCleanupPlan: () => ({ stage: stageMock, isStaging: false }),
}));
jest.mock("../hooks/useSuppressions", () => ({
  useSuppressions: () => ({
    suppressions: [],
    rejectCluster,
    rejectRuleGap,
    rejectAffix: jest.fn(),
    undo: jest.fn(),
    clearAll: jest.fn(),
    isSaving: false,
  }),
}));

// The staged store is real in these tests: staging has to actually remove the
// payees it staged from the candidate set.
let pendingPayeeMerges: { targetId: string; mergeIds: string[] }[] = [];
let stagedPayeeEntries: Record<
  string,
  { isNew: boolean; isUpdated: boolean; isDeleted: boolean }
> = {};
jest.mock("../../../store/staged", () => ({
  useStagedStore: (selector: (s: unknown) => unknown) =>
    selector({ pendingPayeeMerges, payees: stagedPayeeEntries, rules: {} }),
}));

jest.mock("../hooks/usePayeeCleanupCandidates", () => ({
  usePayeeCleanupCandidates: () => ({
    partition: partitionByEligibility(candidates),
    capabilities: getPayeeCleanupCapabilities({ mode }),
    isLoading,
    error: null,
    refetch: jest.fn(),
  }),
}));

beforeEach(() => {
  candidates = [];
  mode = "http-api";
  isLoading = false;
  stagedRules = {};
  transactionCounts = new Map();
  transactionsLoading = false;
  rejectCluster.mockClear();
  rejectRuleGap.mockClear();
  pendingPayeeMerges = [];
  stagedPayeeEntries = {};
  toastSuccess.mockClear();
  stageMock.mockReset();
  stageMock.mockResolvedValue({ status: "staged", operations: 1 });
  importedText = [];
});

/** Deep reasoning is behind an inline toggle; everything else is on the card. */
function openReasoning() {
  fireEvent.click(screen.getAllByRole("button", { name: /^reasoning$/i })[0]);
}

describe("PayeeCleanupView", () => {
  it("shows a suggestion with its members, evidence and target", () => {
    candidates = [
      payee("WOOLWORTHS 0183"),
      payee("WOOLWORTHS 0291"),
      payee("WOOLWORTHS 8442"),
      payee("Woolworths"),
    ];

    render(<PayeeCleanupView />);

    // Everything a decision needs is on one screen: the result, the payees it
    // comes from with their counts, and what was detected.
    const card = screen.getByRole("article");
    expect(within(card).getByLabelText(/final payee name/i)).toHaveValue("Woolworths");
    expect(within(card).getByText(/4 payees/)).toBeInTheDocument();
    // The name renders as spans with the detected noise dimmed, so match the
    // row rather than a contiguous text node.
    expect(within(card).getByTitle("WOOLWORTHS 0183")).toBeInTheDocument();
    expect(within(card).getByLabelText(/^keep Woolworths$/i)).toBeChecked();
    expect(within(card).getByText(/store or terminal number/i)).toBeInTheDocument();
  });

  it("reports how many payees were analyzed and excluded", () => {
    candidates = [
      payee("AMAZON"),
      payee("Amazon"),
      payee("Transfer: Savings", { transferAccountId: "acct-1" }),
    ];

    render(<PayeeCleanupView />);

    // Both live on the toolbar line now — the analyzed count had its own box
    // two inches below itself, and the exclusion note a full sentence.
    expect(
      screen.getByText(/2 payees analyzed · 1 transfer excluded/)
    ).toBeInTheDocument();
  });

  it("puts search, filters and the primary action where Rule Diagnostics does", () => {
    // Two tools doing the same kind of job should not need learning twice.
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    expect(screen.getByLabelText(/search payees/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /suggestions 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^scan again$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stage cleanup/i })).toBeInTheDocument();
  });

  it("keeps the filters, totals and pending changes out of the scrolling list", () => {
    // Triaging fifty groups means scrolling constantly; losing the counts and
    // the Stage button on the first scroll makes the page feel unanchored.
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    const scroller = document.querySelector(".overflow-auto");
    expect(scroller).not.toBeNull();

    // The card is inside the scroll area; the filters and totals are not.
    expect(scroller?.contains(screen.getByRole("article"))).toBe(true);
    expect(scroller?.contains(screen.getByLabelText(/search payees/i))).toBe(false);
    // The summary boxes, matched exactly so the toolbar's own count does not
    // also match.
    expect(scroller?.contains(screen.getByText("Cleanup suggestions"))).toBe(false);
  });

  it("shows what is pending in its own box rather than a panel", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    expect(screen.getByText("None yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));

    expect(screen.getByText("Pending changes")).toBeInTheDocument();
    expect(screen.getByText(/1 merge/)).toBeInTheDocument();
    // The safety line travels with the changes it describes.
    expect(
      screen.getByText(/1 payee stops existing · not written until you save/i)
    ).toBeInTheDocument();
  });

  it("hides the confidence filter on tabs it cannot filter", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    expect(screen.getByRole("button", { name: /needs review/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unused/i }));
    expect(
      screen.queryByRole("button", { name: /needs review/i })
    ).not.toBeInTheDocument();
  });

  it("offers no control that writes to the budget", () => {
    // Accepting marks a proposal for the staged plan; it must not merge, save,
    // apply or delete anything. Those arrive in 041e behind an explicit Save.
    candidates = [payee("AMAZON"), payee("Amazon")];

    render(<PayeeCleanupView />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent ?? "").not.toMatch(/merge now|^save|apply|delete/i);
    }

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    expect(screen.getByText(/not written until you save/i)).toBeInTheDocument();
  });

  it("records a rejection so it survives the next scan", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    fireEvent.click(screen.getByRole("button", { name: /not duplicates/i }));
    expect(rejectCluster).toHaveBeenCalledTimes(1);
  });

  it("lets the user drop a member from a proposal", () => {
    candidates = [payee("AMAZON"), payee("Amazon"), payee("amazon")];
    render(<PayeeCleanupView />);
    const card = screen.getByRole("article");

    fireEvent.click(
      within(card).getAllByRole("button", { name: /remove .* from this group/i })[0]
    );


    // Dropping to two members keeps it a proposal; the removed payee is gone.
    expect(
      within(screen.getByRole("article")).getAllByRole("button", {
        name: /remove .* from this group/i,
      })
    ).toHaveLength(1);
  });

  it("lets the user choose which payee survives", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);


    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[radios.length - 1]);
    expect(radios[radios.length - 1]).toBeChecked();
  });

  it("lets the user add a payee the scan missed", () => {
    // The one correction exclusion cannot emulate.
    candidates = [payee("AMAZON"), payee("Amazon"), payee("Amazon Web Services")];
    render(<PayeeCleanupView />);
    const card = screen.getByRole("article");

    const input = within(card).getByLabelText(/add a payee the scan missed/i);
    fireEvent.change(input, { target: { value: "Amazon Web Services" } });

    // It is now a member of the proposal, which the per-member remove control
    // proves — the name alone also appears in the picker's option list.
    expect(
      within(screen.getByRole("article")).getAllByRole("button", {
        name: /remove .* from this group/i,
      })
    ).toHaveLength(2);
  });

  it("lets the user edit the final name", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);
    const card = screen.getByRole("article");

    const input = within(card).getByLabelText(/final payee name/i);
    fireEvent.change(input, { target: { value: "Amazon Marketplace" } });
    fireEvent.blur(input);

    expect(screen.getByText("Amazon Marketplace")).toBeInTheDocument();
  });

  it("states the Favorite / Category-learning outcome on the group it affects", () => {
    // This used to be a page-wide banner that also claimed the feature was
    // read-only. It belongs on the group whose settings actually differ.
    candidates = [payee("AMAZON", { favorite: true }), payee("Amazon")];
    render(<PayeeCleanupView />);

    expect(
      screen.getByText(/Favorite \/ Category learning differ/i)
    ).toBeInTheDocument();
  });

  it("discloses the stricter unused-payee check where it applies", () => {
    // On the Unused tab, next to the list it describes — not in a page-wide
    // banner over suggestions it has nothing to do with.
    candidates = [payee("Old Test Payee"), payee("AMAZON"), payee("Amazon")];
    transactionCounts = new Map([["p-AMAZON", 4]]);

    render(<PayeeCleanupView />);
    expect(screen.queryByText(/more cautious than Actual/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /unused/i }));
    expect(screen.getByText(/more cautious than Actual/i)).toBeInTheDocument();
  });

  it("does not convey confidence by colour alone", () => {
    candidates = [payee("WOOLWORTHS 0183"), payee("WOOLWORTHS 0291")];
    render(<PayeeCleanupView />);

    // The band is words, not a colour — and not a percentage either, which
    // would read as a calibrated probability it is not.
    expect(
      screen.getAllByText(/^(High confidence|Likely|Needs review|Ambiguous)$/).length
    ).toBeGreaterThan(0);
  });

  it("tells the user plainly when there is nothing to clean up", () => {
    candidates = [payee("Woolworths"), payee("Tesco")];
    render(<PayeeCleanupView />);

    expect(
      screen.getByText(/No duplicate or variant payees found/i)
    ).toBeInTheDocument();
  });

  it("says plainly that merging does not rewrite rules", () => {
    // The most surprising thing about Actual's merge, and the user is about to
    // rely on it.
    candidates = [payee("AMAZON"), payee("Amazon")];
    stagedRules = {
      r1: {
        entity: {
          id: "r1",
          stage: "default",
          conditionsOp: "and",
          conditions: [{ field: "payee", op: "is", value: "p-AMAZON" }],
          actions: [],
        },
        original: null,
        isNew: false,
        isUpdated: false,
        isDeleted: false,
        validationErrors: {},
      },
    };

    render(<PayeeCleanupView />);

    expect(screen.getByText(/merging does not rewrite them/i)).toBeInTheDocument();
  });

  it("shows counting rather than zero while transactions load", () => {
    // Rendering 0 during load reads as "unused", the opposite of the truth.
    candidates = [payee("AMAZON"), payee("Amazon")];
    transactionCounts = undefined;
    transactionsLoading = true;

    render(<PayeeCleanupView />);

    expect(screen.getAllByText(/counting/i).length).toBeGreaterThan(0);
  });

  it("lists unused payees on their own tab, with the stricter-check note", () => {
    candidates = [payee("Old Test Payee"), payee("AMAZON"), payee("Amazon")];
    transactionCounts = new Map([["p-AMAZON", 4]]);

    render(<PayeeCleanupView />);
    fireEvent.click(screen.getByRole("button", { name: /unused/i }));

    expect(screen.getByText("Old Test Payee")).toBeInTheDocument();
    expect(screen.getByText(/more cautious than Actual/i)).toBeInTheDocument();
  });

  it("keeps the toolbar's Stage button disabled until something is accepted", () => {
    // The summary strip stays silent too: an empty "nothing accepted yet" panel
    // above every scan is noise.
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    expect(screen.getByRole("button", { name: /stage cleanup/i })).toBeDisabled();
    expect(screen.queryByText(/nothing accepted yet/i)).not.toBeInTheDocument();
  });

  it("stages an accepted proposal and says nothing was written", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));

    expect(screen.getByText(/1 payee stops existing/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /stage cleanup/i }));
    expect(stageMock).toHaveBeenCalledTimes(1);

    // The confirmation is a moment, not a state — it goes to a toast rather
    // than parking a panel on the page.
    return Promise.resolve().then(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/staged — save on the Payees page/)
      );
      expect(screen.queryByText(/1 change staged\./)).not.toBeInTheDocument();
    });
  });

  it("counts the payees that will stop existing, not just the operations", () => {
    // "12 changes" tells a user nothing about whether a payee disappears.
    candidates = [payee("AMAZON"), payee("Amazon"), payee("amazon")];
    render(<PayeeCleanupView />);

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    expect(screen.getByText(/2 payees stop existing/i)).toBeInTheDocument();
  });

  it("offers a rule that catches the payee, unchecked until the user opts in", () => {
    candidates = [payee("AMAZON 1234"), payee("AMAZON 5678")];
    importedText = [
      { field: "imported_payee", text: "AMAZON 1234", payeeId: "p-AMAZON 1234", transactionCount: 12 },
      { field: "imported_payee", text: "AMAZON 5678", payeeId: "p-AMAZON 5678", transactionCount: 8 },
      { field: "imported_payee", text: "TESCO 9", payeeId: "p-other", transactionCount: 3 },
    ];

    render(<PayeeCleanupView />);


    const toggle = screen.getByRole("checkbox", {
      name: /create a rule so future imports match this payee/i,
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("article").textContent).toMatch(
      /Matches 20 of this group's past transactions and nothing else/
    );
  });

  it("says no rule is needed when the kept name already resolves the imports", () => {
    // Actual matches an imported name to an existing payee by name, so cleanup
    // alone often fixes future imports — proposing a rule anyway is sprawl.
    candidates = [payee("Amazon"), payee("AMAZON")];
    importedText = [
      { field: "imported_payee", text: "Amazon", payeeId: "p-Amazon", transactionCount: 30 },
      { field: "imported_payee", text: "AMAZON", payeeId: "p-AMAZON", transactionCount: 2 },
    ];

    render(<PayeeCleanupView />);

    expect(screen.getByText(/Actual will match these imports by name/i)).toBeInTheDocument();
  });

  it("lets the user narrow the rule's matched text", () => {
    // The generated pattern anchors on the reduced stem, which can be narrower
    // than the merchant: a rule for "HUNGRY JACKS MELBOURNE" misses every other
    // suburb.
    candidates = [payee("HUNGRY JACKS 0183"), payee("HUNGRY JACKS 0291")];
    importedText = [
      {
        field: "imported_payee",
        text: "HUNGRY JACKS 0183",
        payeeId: "p-HUNGRY JACKS 0183",
        transactionCount: 4,
      },
      {
        field: "imported_payee",
        text: "HUNGRY JACKS 0291",
        payeeId: "p-HUNGRY JACKS 0291",
        transactionCount: 6,
      },
    ];

    render(<PayeeCleanupView />);


    const input = screen.getByLabelText(/text the rule should match/i);
    fireEvent.change(input, { target: { value: "HUNGRY" } });
    fireEvent.blur(input);

    // The pattern is rebuilt and re-scored from what the user typed.
    expect(screen.getByLabelText(/text the rule should match/i)).toHaveValue("HUNGRY");
    expect(screen.getByText(/\^HUNGRY/)).toBeInTheDocument();
  });

  it("keeps the pattern editor reachable after choosing a field with no matches", () => {
    // Selecting a field the history cannot match leaves no recommendation. If
    // that also removed the editor, the user could not choose another field or
    // type text that would match — a one-way trip out of the rule.
    candidates = [payee("HUNGRY JACKS 0183"), payee("HUNGRY JACKS 0291")];
    importedText = [
      {
        field: "imported_payee",
        text: "HUNGRY JACKS 0183",
        payeeId: "p-HUNGRY JACKS 0183",
        transactionCount: 4,
      },
      {
        field: "imported_payee",
        text: "HUNGRY JACKS 0291",
        payeeId: "p-HUNGRY JACKS 0291",
        transactionCount: 6,
      },
    ];

    render(<PayeeCleanupView />);

    const field = screen.getByLabelText(/which field the rule matches on/i);
    fireEvent.change(field, { target: { value: "notes" } });

    // Nothing in the history is a note, so there is no recommendation — but the
    // controls are still there, and they still show the user's choice.
    expect(screen.getByLabelText(/which field the rule matches on/i)).toHaveValue(
      "notes"
    );
    expect(screen.getByLabelText(/text the rule should match/i)).toBeInTheDocument();

    // And the explanation names the real reason rather than a generic one.
    expect(
      screen.getByText(/nothing in the imported text on record matches this pattern/i)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/which field the rule matches on/i), {
      target: { value: "imported_payee" },
    });
    // Back on a field the history can match, the recommendation returns.
    expect(screen.getByText(/\^HUNGRY/)).toBeInTheDocument();
  });

  it("keeps the deep reasoning behind an inline toggle, not a dialog", () => {
    candidates = [payee("WOOLWORTHS 0183"), payee("WOOLWORTHS 0291")];
    render(<PayeeCleanupView />);

    // The score lives here, next to the reasoning that produced it — not on the
    // card, where a heuristic reads as a calibrated probability.
    expect(screen.queryByText(/^\d+% —/)).not.toBeInTheDocument();
    openReasoning();
    expect(screen.getByText(/^\d+% —/)).toBeInTheDocument();
    // No modal: the card stays in the accessibility tree.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("article")).toBeInTheDocument();
  });

  it("keeps the collapsed card to what a decision needs (F-096)", () => {
    // The complaint was density: correct information, badly rationed. The
    // reasoning, the impact breakdown and every editing control belong behind
    // the toggle; the decision itself does not.
    candidates = [payee("WOOLWORTHS 0183"), payee("WOOLWORTHS 0291")];
    render(<PayeeCleanupView />);

    expect(screen.getByRole("button", { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /not duplicates/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reasoning$/i })).toBeInTheDocument();

    // In the drawer, not on the card.
    // The payee list appears exactly once — it carries the survivor choice and
    // the counts together, rather than being printed again as a breakdown.
    expect(screen.queryByText(/per payee/i)).not.toBeInTheDocument();
    // Deep reasoning stays behind the toggle.
    expect(screen.queryByText(/keeping this payee/i)).not.toBeInTheDocument();
  });

  it("keeps the safety copy with whatever is pending", () => {
    // The line moved from under every card into the summary strip, which
    // appears as soon as there is something to save. A disclosure repeated
    // fifty times is wallpaper; one that never appears is worse.
    candidates = [payee("AMAZON", { favorite: true }), payee("Amazon")];
    render(<PayeeCleanupView />);

    // The settings warning belongs to the group it affects, so it is on the card.
    expect(screen.getByText(/Favorite \/ Category learning differ/i)).toBeInTheDocument();
    expect(screen.queryByText(/not written until you save/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));

    expect(
      screen.getByText(/1 payee stops existing · not written until you save/i)
    ).toBeInTheDocument();
  });

  it("uses the page width instead of one tall column", () => {
    // Three sections side by side — result, what changes, future imports — so a
    // suggestion is one glance rather than a scroll.
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    const card = screen.getByRole("article");
    expect(within(card).getByText("Result")).toBeInTheDocument();
    expect(within(card).getByText("What changes")).toBeInTheDocument();
    expect(within(card).getByText("Future imports")).toBeInTheDocument();
  });

  it("groups Undo with the other whole-suggestion actions, only once there is something to undo", () => {
    // It used to sit at the bottom of the Future imports column, which has
    // nothing to do with undoing an edit.
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    expect(
      screen.queryByRole("button", { name: /undo my changes/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));

    const header = screen.getByRole("article").querySelector("header");
    expect(
      within(header as HTMLElement).getByRole("button", { name: /undo my changes/i })
    ).toBeInTheDocument();
  });

  it("restores the detector's proposal when undo is used", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    const name = screen.getByLabelText(/final payee name/i);
    fireEvent.change(name, { target: { value: "Something Else" } });
    fireEvent.blur(name);
    expect(screen.getByDisplayValue("Something Else")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /undo my changes/i }));
    expect(screen.queryByDisplayValue("Something Else")).not.toBeInTheDocument();
  });

  it("triages from the keyboard on the focused card", () => {
    // A/R/N are scoped to the card, so they cannot fire while the user is
    // typing in the search box or a drawer field.
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    const card = screen.getByRole("article");
    card.focus();
    fireEvent.keyDown(card, { key: "a" });

    expect(screen.getByRole("button", { name: /accepted/i })).toBeInTheDocument();
  });

  it("does not fire triage keys while the user is typing in the card", () => {
    // The card is full of inputs now — a rename field, a rule pattern, an
    // add-payee box. Window-level shortcuts would reject a suggestion the
    // moment someone typed an "n".
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    const nameField = screen.getByLabelText(/final payee name/i);
    fireEvent.keyDown(nameField, { key: "n" });
    fireEvent.keyDown(nameField, { key: "a" });

    expect(rejectCluster).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /accepted/i })
    ).not.toBeInTheDocument();
  });

  it("accepts the confident suggestions in one action, never the uncertain ones", () => {
    // Forty cards each needing a click is the same complaint in another form.
    candidates = [
      payee("WOOLWORTHS 0183"),
      payee("WOOLWORTHS 0291"),
      payee("WOOLWORTHS 8442"),
      payee("TESCO 0001"),
      payee("TESCO 0002"),
      payee("TESCO 0003"),
      // A fuzzy-only pair lands in "needs review" and must be left alone.
      payee("Carrefour Market"),
      payee("Carrefour Markt"),
    ];
    render(<PayeeCleanupView />);

    fireEvent.click(screen.getByRole("button", { name: /accept 2 safe/i }));
    expect(screen.getAllByRole("button", { name: /accepted/i })).toHaveLength(2);
  });

  it("offers to combine groups the user has given the same name", () => {
    // Naming two groups the same thing is the user saying those payees are one
    // merchant — the scan could not see it because the names reduce to
    // different stems. Blocking alone leaves them to reconcile it by hand.
    candidates = [
      payee("WOOLWORTHS 0183"),
      payee("WOOLWORTHS 0291"),
      payee("TESCO 0001"),
      payee("TESCO 0002"),
    ];
    render(<PayeeCleanupView />);

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);

    // Accept both, then name them the same thing.
    for (const card of cards) {
      fireEvent.click(within(card).getByRole("button", { name: /^accept$/i }));
      const name = within(card).getByLabelText(/final payee name/i);
      fireEvent.change(name, { target: { value: "Groceries Shop" } });
      fireEvent.blur(name);
    }

    expect(
      screen.getByText(/2 groups are all named/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /combine into one group/i }));

    // One group now holds all four payees, and the collision is gone.
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText(/groups are all named/i)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("article")).getByText(/4 payees/)
    ).toBeInTheDocument();
  });

  it("says what a risky rule catches as well as what it over-catches", () => {
    // "Also catches 1 transaction of X" alone gives no sense of whether the
    // rule is otherwise doing its job.
    candidates = [payee("WOOLWORTHS 0183"), payee("WOOLWORTHS 0291")];
    importedText = [
      { field: "imported_payee", text: "WOOLWORTHS 0183", payeeId: "p-WOOLWORTHS 0183", transactionCount: 4 },
      { field: "imported_payee", text: "WOOLWORTHS 0291", payeeId: "p-WOOLWORTHS 0291", transactionCount: 2 },
      { field: "imported_payee", text: "WOOLWORTHS MOBILE", payeeId: "p-other", transactionCount: 1 },
    ];

    render(<PayeeCleanupView />);

    // The sentence is built from several nodes, so read the card's text.
    const text = screen.getByRole("article").textContent ?? "";
    expect(text).toMatch(/Matches 6 ?of this group's past transactions/);
    expect(text).toMatch(/and 1 transaction of/);
    expect(text).toMatch(/Narrow the text, or add that payee to this group/);
  });

  it("drops a group from the list once its payees are staged", () => {
    // The candidate list comes from a fresh read that knows nothing about the
    // staged store. Without this, staging left every suggestion on screen and
    // the same merge could be staged twice.
    candidates = [payee("WOOLWORTHS 0183"), payee("WOOLWORTHS 0291")];

    const { rerender } = render(<PayeeCleanupView />);
    expect(screen.getAllByRole("article")).toHaveLength(1);

    pendingPayeeMerges = [
      { targetId: "p-WOOLWORTHS 0183", mergeIds: ["p-WOOLWORTHS 0291"] },
    ];
    rerender(<PayeeCleanupView />);

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("does not call an untouched working set staged changes", () => {
    // The staged store holds every loaded payee, not only the edited ones, so
    // counting its keys announced "441 changes are staged" on a page where
    // nothing had been touched.
    candidates = [payee("WOOLWORTHS 0183"), payee("WOOLWORTHS 0291")];
    stagedPayeeEntries = {
      "p-WOOLWORTHS 0183": { isNew: false, isUpdated: false, isDeleted: false },
      "p-WOOLWORTHS 0291": { isNew: false, isUpdated: false, isDeleted: false },
    };

    render(<PayeeCleanupView />);

    expect(screen.queryByText(/staged and\s+waiting/i)).not.toBeInTheDocument();
  });

  it("counts a staged rename, which produces no merge at all", () => {
    // A rename-only plan was reported as nothing pending — the one case this
    // reminder exists for.
    candidates = [payee("WOOLWORTHS 0183"), payee("WOOLWORTHS 0291")];
    stagedPayeeEntries = {
      "p-WOOLWORTHS 0183": { isNew: false, isUpdated: true, isDeleted: false },
    };

    render(<PayeeCleanupView />);

    expect(screen.getByText(/1 change is staged and waiting/i)).toBeInTheDocument();
  });

  it("lists a curated payee whose imports will not resolve to it again", () => {
    // Actual matches an imported payee by name alone, so `NETFLIX.COM 4821`
    // will not find the payee now called `Netflix` — it will create a duplicate.
    candidates = [payee("Netflix"), payee("Spotify")];
    importedText = [
      {
        field: "imported_payee",
        text: "NETFLIX.COM 4821",
        payeeId: "p-Netflix",
        transactionCount: 9,
      },
      {
        field: "imported_payee",
        text: "Spotify",
        payeeId: "p-Spotify",
        transactionCount: 9,
      },
    ];
    transactionCounts = new Map([
      ["p-Netflix", 9],
      ["p-Spotify", 9],
    ]);

    render(<PayeeCleanupView />);
    fireEvent.click(screen.getByRole("button", { name: /needs a rule/i }));

    // Spotify already resolves by name, so it must not be listed.
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.queryByText("Spotify")).not.toBeInTheDocument();
    expect(screen.getByText(/nothing here changes a payee/i)).toBeInTheDocument();
  });

  it("offers to create the safe rules in bulk", () => {
    candidates = [payee("Netflix")];
    importedText = [
      {
        field: "imported_payee",
        text: "NETFLIX.COM 4821",
        payeeId: "p-Netflix",
        transactionCount: 9,
      },
    ];
    transactionCounts = new Map([["p-Netflix", 9]]);

    render(<PayeeCleanupView />);
    fireEvent.click(screen.getByRole("button", { name: /needs a rule/i }));

    const bulk = screen.getByRole("button", { name: /create 1 safe rule/i });
    fireEvent.click(bulk);

    expect(
      screen.getByRole("checkbox", { name: /create a rule for Netflix/i })
    ).toBeChecked();
  });

  it("records that a payee does not need a rule", () => {
    candidates = [payee("Netflix")];
    importedText = [
      {
        field: "imported_payee",
        text: "NETFLIX.COM 4821",
        payeeId: "p-Netflix",
        transactionCount: 9,
      },
    ];
    transactionCounts = new Map([["p-Netflix", 9]]);

    render(<PayeeCleanupView />);
    fireEvent.click(screen.getByRole("button", { name: /needs a rule/i }));
    fireEvent.click(screen.getByRole("button", { name: /doesn't need one/i }));

    expect(rejectRuleGap).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Netflix" })
    );
  });

  it("keeps unstaged work when only some groups are staged", () => {
    // Clearing every correction after a stage threw away renames, target
    // choices and combined groups the user was still working on — which looked
    // exactly like the work had been lost.
    candidates = [
      payee("WOOLWORTHS 0183"),
      payee("WOOLWORTHS 0291"),
      payee("TESCO 0001"),
      payee("TESCO 0002"),
    ];
    render(<PayeeCleanupView />);

    const [first, second] = screen.getAllByRole("article");
    fireEvent.click(within(first).getByRole("button", { name: /^accept$/i }));

    // The second group is mid-edit and not accepted.
    const name = within(second).getByLabelText(/final payee name/i);
    fireEvent.change(name, { target: { value: "Still Editing" } });
    fireEvent.blur(name);

    fireEvent.click(screen.getByRole("button", { name: /stage cleanup/i }));

    return Promise.resolve().then(() => {
      expect(screen.getByDisplayValue("Still Editing")).toBeInTheDocument();
    });
  });

  it("labels the search field for screen readers", () => {
    candidates = [payee("AMAZON"), payee("Amazon")];
    render(<PayeeCleanupView />);

    expect(screen.getByRole("searchbox", { name: /search payees/i })).toBeInTheDocument();
  });
});
