import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import type { Rule } from "@/types/entities";
import type { DiagnosticReport, Finding } from "../types";
import { RuleDiagnosticsView } from "./RuleDiagnosticsView";

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    onClick,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

const routerPushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: jest.fn() }),
  usePathname: () => "/rules/diagnostics",
  useSearchParams: () => new URLSearchParams(),
}));

const refreshMock = jest.fn();
type HookResult = {
  report: DiagnosticReport | null;
  running: boolean;
  error: string | null;
  stale: boolean;
  refresh: () => void;
  rules: Rule[];
};
let hookResult: HookResult = {
  report: null,
  running: false,
  error: null,
  stale: false,
  refresh: refreshMock,
  rules: [],
};

jest.mock("../hooks/useRuleDiagnostics", () => ({
  useRuleDiagnostics: () => hookResult,
}));

// Dismissal persistence owns a TanStack query; it is exercised in its own
// suites (the repository, and `lib/dismissals`). This one is about what the
// view renders, so it supplies the loaded shape rather than standing up a
// QueryClientProvider.
const dismissMock = jest.fn();
const restoreMock = jest.fn();
let dismissalRecords: unknown[] = [];
jest.mock("../hooks/useRuleDiagnosticsDismissals", () => ({
  useRuleDiagnosticsDismissals: () => ({
    dismissals: dismissalRecords,
    dismiss: dismissMock,
    restore: restoreMock,
    collectGarbage: jest.fn(),
    isSaving: false,
  }),
}));

const stagedRulesState: Record<string, { isDeleted: boolean }> = {};
jest.mock("../../../store/staged", () => ({
  useStagedStore: Object.assign(() => ({}), {
    getState: () => ({ rules: stagedRulesState }),
  }),
}));

const toastErrorMock = jest.fn();
jest.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: jest.fn(),
  },
}));

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeFinding(partial: Partial<Finding> & { code: Finding["code"] }): Finding {
  return {
    code: partial.code,
    severity: partial.severity ?? "warning",
    title: partial.title ?? "A finding",
    message: partial.message ?? "a message",
    affected: partial.affected ?? [{ id: "rule-1", summary: "rule one" }],
    ...(partial.counterpart ? { counterpart: partial.counterpart } : {}),
    ...(partial.details ? { details: partial.details } : {}),
  };
}

function makeReport(findings: Finding[]): DiagnosticReport {
  const summary = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const f of findings) summary[f.severity] += 1;
  return {
    runAt: "2026-04-23T12:00:00.000Z",
    findings,
    summary,
    workingSetSignature: "sig-1",
    ruleCount: findings.length,
  };
}

beforeEach(() => {
  refreshMock.mockReset();
  toastErrorMock.mockReset();
  routerPushMock.mockReset();
  for (const key of Object.keys(stagedRulesState)) delete stagedRulesState[key];
  dismissMock.mockReset();
  restoreMock.mockReset();
  dismissalRecords = [];
  hookResult = {
    report: null,
    running: false,
    error: null,
    stale: false,
    refresh: refreshMock,
    rules: [],
  };
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RuleDiagnosticsView", () => {
  it("renders the loading state while running and no report yet", () => {
    hookResult = { ...hookResult, running: true, report: null };
    render(<RuleDiagnosticsView />);
    expect(screen.getByLabelText("Loading…")).toBeInTheDocument();
  });

  it("renders an error banner when the engine errors and there is no report", () => {
    hookResult = { ...hookResult, error: "boom", report: null };
    render(<RuleDiagnosticsView />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders the empty state when the report has no findings", () => {
    hookResult = { ...hookResult, report: makeReport([]) };
    render(<RuleDiagnosticsView />);
    expect(screen.getByText("No issues found")).toBeInTheDocument();
  });

  it("renders counts on the filter, and findings in rank order", () => {
    const error = makeFinding({
      code: "RULE_MISSING_PAYEE",
      severity: "error",
      title: "Error finding",
      affected: [{ id: "r-err", summary: "error rule summary" }],
    });
    const warning = makeFinding({
      code: "RULE_BROAD_MATCH",
      severity: "warning",
      title: "Warning finding",
      affected: [{ id: "r-warn", summary: "warning rule summary" }],
    });
    hookResult = { ...hookResult, report: makeReport([error, warning]) };
    render(<RuleDiagnosticsView />);

    // One filter group carries every count — no summary cards, no tab strip.
    expect(screen.getByText("All 2")).toBeInTheDocument();
    expect(screen.getByText("Errors 1")).toBeInTheDocument();
    expect(screen.getByText("Warnings 1")).toBeInTheDocument();
    expect(screen.getByText("Error finding")).toBeInTheDocument();
    expect(screen.getByText("Warning finding")).toBeInTheDocument();

    const errorIndex = document.body.textContent!.indexOf("Error finding");
    const warningIndex = document.body.textContent!.indexOf("Warning finding");
    expect(errorIndex).toBeLessThan(warningIndex);
  });

  it("renders the stale banner when stale is true", () => {
    hookResult = { ...hookResult, stale: true, report: makeReport([]) };
    render(<RuleDiagnosticsView />);
    expect(
      screen.getByText(/Results are out of date/i)
    ).toBeInTheDocument();
  });

  it("calls refresh() when the toolbar Refresh button is clicked", () => {
    hookResult = { ...hookResult, report: makeReport([]) };
    render(<RuleDiagnosticsView />);
    fireEvent.click(screen.getByLabelText("Refresh rule diagnostics"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders rule summary as a Link to /rules?highlight=<id> with aria-label", () => {
    const finding = makeFinding({
      code: "RULE_MISSING_PAYEE",
      severity: "error",
      affected: [{ id: "rule-xyz", summary: "rule one" }],
    });
    hookResult = { ...hookResult, report: makeReport([finding]) };
    stagedRulesState["rule-xyz"] = { isDeleted: false };
    render(<RuleDiagnosticsView />);
    const link = screen.getByLabelText("Open rule: rule one") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/rules?highlight=rule-xyz");
  });

  it("toasts and prevents navigation when clicking a rule that no longer exists", () => {
    const finding = makeFinding({
      code: "RULE_MISSING_PAYEE",
      severity: "error",
      affected: [{ id: "missing-rule", summary: "missing one" }],
    });
    hookResult = { ...hookResult, report: makeReport([finding]) };
    // Note: stagedRulesState is empty, so missing-rule isn't there.
    render(<RuleDiagnosticsView />);
    const link = screen.getByLabelText("Open rule: missing one");
    fireEvent.click(link);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock.mock.calls[0][0]).toMatch(/no longer exists/i);
  });

  describe("filters", () => {
    function buildReportFor(): { errF: Finding; warnF: Finding; infoF: Finding } {
      return {
        errF: makeFinding({
          code: "RULE_MISSING_PAYEE",
          severity: "error",
          title: "Error finding",
          affected: [{ id: "r-err", summary: "err summary" }],
        }),
        warnF: makeFinding({
          code: "RULE_BROAD_MATCH",
          severity: "warning",
          title: "Warning finding",
          affected: [{ id: "r-warn", summary: "warn summary" }],
        }),
        infoF: makeFinding({
          code: "RULE_NEAR_DUPLICATE_FAMILY",
          severity: "info",
          title: "Info finding",
          affected: [{ id: "r-info", summary: "info summary" }],
        }),
      };
    }

    it("selecting a severity pill hides findings of other severities", () => {
      const { errF, warnF, infoF } = buildReportFor();
      hookResult = { ...hookResult, report: makeReport([errF, warnF, infoF]) };
      render(<RuleDiagnosticsView />);

      fireEvent.click(screen.getByText("Errors 1"));
      expect(screen.getByText("Error finding")).toBeInTheDocument();
      expect(screen.queryByText("Warning finding")).not.toBeInTheDocument();
      expect(screen.queryByText("Info finding")).not.toBeInTheDocument();
    });

    it("clearing filters restores the full list", () => {
      const { errF, warnF, infoF } = buildReportFor();
      hookResult = { ...hookResult, report: makeReport([errF, warnF, infoF]) };
      render(<RuleDiagnosticsView />);

      fireEvent.click(screen.getByText("Errors 1"));
      expect(screen.queryByText("Warning finding")).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText("Clear all filters"));
      expect(screen.getByText("Error finding")).toBeInTheDocument();
      expect(screen.getByText("Warning finding")).toBeInTheDocument();
      expect(screen.getByText("Info finding")).toBeInTheDocument();
    });

    it("shows every severity in one list, and narrows to a scope on demand", () => {
      const { errF, warnF, infoF } = buildReportFor();
      hookResult = { ...hookResult, report: makeReport([errF, warnF, infoF]) };
      render(<RuleDiagnosticsView />);

      // All three are visible at once — info reads as "Suggestions" in the
      // filter, but it is not hidden behind a tab.
      expect(screen.getByText("3 findings")).toBeInTheDocument();
      expect(screen.getByText("Error finding")).toBeInTheDocument();
      expect(screen.getByText("Info finding")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Suggestions 1"));

      expect(screen.getByText("Info finding")).toBeInTheDocument();
      // Both of the other severities, not just the error: a regression that
      // left warnings in the suggestions scope would otherwise pass.
      expect(screen.queryByText("Error finding")).not.toBeInTheDocument();
      expect(screen.queryByText("Warning finding")).not.toBeInTheDocument();
    });

    it("typing in the search box filters findings by rule summary", () => {
      const { errF, warnF, infoF } = buildReportFor();
      hookResult = { ...hookResult, report: makeReport([errF, warnF, infoF]) };
      render(<RuleDiagnosticsView />);

      const searchInput = screen.getByLabelText("Search findings by rule");
      fireEvent.change(searchInput, { target: { value: "warn summary" } });
      expect(screen.queryByText("Error finding")).not.toBeInTheDocument();
      expect(screen.getByText("Warning finding")).toBeInTheDocument();
      expect(screen.queryByText("Info finding")).not.toBeInTheDocument();
    });

    it("renders a Go to Rules button that navigates to /rules", () => {
      hookResult = { ...hookResult, report: makeReport([]) };
      render(<RuleDiagnosticsView />);
      const backButton = screen.getByLabelText("Go to rules");
      fireEvent.click(backButton);
      expect(routerPushMock).toHaveBeenCalledWith("/rules");
    });
  });

  describe("merge button", () => {
    it("renders a Merge button on a near-duplicate finding with a 2-rule label", () => {
      const finding = makeFinding({
        code: "RULE_NEAR_DUPLICATE_FAMILY",
        severity: "info",
        affected: [
          { id: "rule-a", summary: "rule A" },
          { id: "rule-b", summary: "rule B" },
        ],
      });
      hookResult = { ...hookResult, report: makeReport([finding]) };
      stagedRulesState["rule-a"] = { isDeleted: false };
      stagedRulesState["rule-b"] = { isDeleted: false };
      render(<RuleDiagnosticsView />);
      // A family is a suggestion, not something wrong.
      fireEvent.click(screen.getByText("Suggestions 1"));
      expect(screen.getByLabelText("Merge 2 rules")).toBeInTheDocument();
    });

    it("renders a Merge button on a duplicate-group finding labelled with the cluster size", () => {
      const finding = makeFinding({
        code: "RULE_DUPLICATE_GROUP",
        severity: "warning",
        affected: [
          { id: "rule-1", summary: "rule 1" },
          { id: "rule-2", summary: "rule 2" },
          { id: "rule-3", summary: "rule 3" },
        ],
      });
      hookResult = { ...hookResult, report: makeReport([finding]) };
      stagedRulesState["rule-1"] = { isDeleted: false };
      stagedRulesState["rule-2"] = { isDeleted: false };
      stagedRulesState["rule-3"] = { isDeleted: false };
      render(<RuleDiagnosticsView />);
      expect(screen.getByLabelText("Merge 3 rules")).toBeInTheDocument();
    });

    it("does NOT render a Merge button on a non-mergeable finding", () => {
      const finding = makeFinding({
        code: "RULE_BROAD_MATCH",
        severity: "warning",
      });
      hookResult = { ...hookResult, report: makeReport([finding]) };
      render(<RuleDiagnosticsView />);
      expect(screen.queryByLabelText(/^Merge \d+ rules?$/)).not.toBeInTheDocument();
    });

    it("clicking Merge on a duplicate-group navigates to /rules?merge=...&from=diagnostics&intent=duplicate", () => {
      const finding = makeFinding({
        code: "RULE_DUPLICATE_GROUP",
        severity: "warning",
        affected: [
          { id: "rule-1", summary: "rule 1" },
          { id: "rule-2", summary: "rule 2" },
        ],
      });
      hookResult = { ...hookResult, report: makeReport([finding]) };
      stagedRulesState["rule-1"] = { isDeleted: false };
      stagedRulesState["rule-2"] = { isDeleted: false };
      render(<RuleDiagnosticsView />);
      fireEvent.click(screen.getByLabelText("Merge 2 rules"));
      expect(routerPushMock).toHaveBeenCalledTimes(1);
      expect(routerPushMock.mock.calls[0][0]).toBe(
        "/rules?merge=rule-1,rule-2&from=diagnostics&intent=duplicate"
      );
    });

    it("clicking Merge on a near-duplicate uses intent=near-duplicate", () => {
      const finding = makeFinding({
        code: "RULE_NEAR_DUPLICATE_FAMILY",
        severity: "info",
        affected: [
          { id: "r-x", summary: "rule x" },
          { id: "r-y", summary: "rule y" },
        ],
      });
      hookResult = { ...hookResult, report: makeReport([finding]) };
      stagedRulesState["r-x"] = { isDeleted: false };
      stagedRulesState["r-y"] = { isDeleted: false };
      render(<RuleDiagnosticsView />);
      fireEvent.click(screen.getByText("Suggestions 1"));
      fireEvent.click(screen.getByLabelText("Merge 2 rules"));
      expect(routerPushMock.mock.calls[0][0]).toBe(
        "/rules?merge=r-x,r-y&from=diagnostics&intent=near-duplicate"
      );
    });

    it("toasts and does not navigate when one of the rules has been staged-deleted", () => {
      const finding = makeFinding({
        code: "RULE_DUPLICATE_GROUP",
        severity: "warning",
        affected: [
          { id: "rule-1", summary: "rule 1" },
          { id: "rule-2", summary: "rule 2" },
        ],
      });
      hookResult = { ...hookResult, report: makeReport([finding]) };
      stagedRulesState["rule-1"] = { isDeleted: false };
      // rule-2 missing on purpose
      render(<RuleDiagnosticsView />);
      fireEvent.click(screen.getByLabelText("Merge 2 rules"));
      expect(routerPushMock).not.toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock.mock.calls[0][0]).toMatch(/no longer exists/i);
    });
  });
  it("dismisses a finding with the rules it is about", () => {
    const finding = makeFinding({
      code: "RULE_BROAD_MATCH",
      title: "Suspiciously broad match criteria",
      affected: [{ id: "rule-1", summary: "rule one" }],
    });
    hookResult = { ...hookResult, report: makeReport([finding]) };
    render(<RuleDiagnosticsView />);

    fireEvent.click(screen.getByLabelText("Dismiss: Suspiciously broad match criteria"));

    expect(dismissMock).toHaveBeenCalledTimes(1);
    expect(dismissMock.mock.calls[0][0]).toBe(finding);
  });

  it("hides a dismissed finding and offers it back", () => {
    const finding = makeFinding({
      code: "RULE_BROAD_MATCH",
      title: "Suspiciously broad match criteria",
      affected: [{ id: "rule-1", summary: "rule one" }],
    });
    hookResult = { ...hookResult, report: makeReport([finding]) };
    dismissalRecords = [
      {
        id: "dismissal-1",
        budgetSyncId: "budget-1",
        code: "RULE_BROAD_MATCH",
        ruleIds: ["rule-1"],
        signatures: [],
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    render(<RuleDiagnosticsView />);

    // Gone from the list, and the page reads clean rather than pretending the
    // finding was never there.
    expect(screen.queryByLabelText("Dismiss: Suspiciously broad match criteria")).toBeNull();
    expect(screen.getByText("No issues found")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /review 1 dismissed finding/i }));
    fireEvent.click(screen.getByLabelText("Restore: Suspiciously broad match criteria"));

    expect(restoreMock).toHaveBeenCalledWith("dismissal-1");
  });

  it("takes a dismissed finding out of the counts and into its own scope", () => {
    const kept = makeFinding({
      code: "RULE_EMPTY_ACTIONS",
      title: "Rule has no actions",
      affected: [{ id: "rule-2", summary: "rule two" }],
    });
    const hidden = makeFinding({
      code: "RULE_BROAD_MATCH",
      title: "Suspiciously broad match criteria",
      affected: [{ id: "rule-1", summary: "rule one" }],
    });
    hookResult = { ...hookResult, report: makeReport([kept, hidden]) };
    dismissalRecords = [
      {
        id: "dismissal-1",
        budgetSyncId: "budget-1",
        code: "RULE_BROAD_MATCH",
        ruleIds: ["rule-1"],
        signatures: [],
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    render(<RuleDiagnosticsView />);

    // The filter carries the split: one finding is still live, one is put away.
    expect(screen.getByText("All 1")).toBeInTheDocument();
    expect(screen.getByText("Dismissed 1")).toBeInTheDocument();
    expect(screen.getByText("Rule has no actions")).toBeInTheDocument();
    expect(screen.queryByText("Suspiciously broad match criteria")).not.toBeInTheDocument();
  });
  it("will not dismiss while the report is stale", () => {
    // The finding describes the rules as they were when the report ran; the
    // signatures a dismissal stores come from the rules as they are now. Taking
    // a decision across that gap records evidence the user never saw.
    const finding = makeFinding({
      code: "RULE_BROAD_MATCH",
      title: "Suspiciously broad match criteria",
      affected: [{ id: "rule-1", summary: "rule one" }],
    });
    hookResult = { ...hookResult, stale: true, report: makeReport([finding]) };
    render(<RuleDiagnosticsView />);

    expect(screen.getByText(/Results are out of date/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Dismiss: Suspiciously broad match criteria")
    ).not.toBeInTheDocument();
    // The finding itself is still readable — only the decision is withheld.
    expect(screen.getByText("Suspiciously broad match criteria")).toBeInTheDocument();
  });
});
