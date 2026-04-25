/**
 * Regression guard for FR-016 / SC-005 / Constitution Principle I (Staged-First Safety).
 *
 * Renders the full RuleDiagnosticsView with a canned report containing every severity,
 * spies on every staged-store mutator, exercises the view (filter toggle, refresh,
 * jump-to-rule click), and asserts that none of the mutators were invoked.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import type { DiagnosticReport, Finding } from "./types";
import { RuleDiagnosticsView } from "./components/RuleDiagnosticsView";

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

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/rules/diagnostics",
  useSearchParams: () => new URLSearchParams(),
}));

const refreshMock = jest.fn();
let hookResult: {
  report: DiagnosticReport | null;
  running: boolean;
  error: string | null;
  stale: boolean;
  refresh: () => void;
} = {
  report: null,
  running: false,
  error: null,
  stale: false,
  refresh: refreshMock,
};

jest.mock("./hooks/useRuleDiagnostics", () => ({
  useRuleDiagnostics: () => hookResult,
}));

// Build a comprehensive set of mutator spies. If any of these is called, the test fails.
const mutatorSpies = {
  stageNew: jest.fn(),
  stageUpdate: jest.fn(),
  stageDelete: jest.fn(),
  revertEntity: jest.fn(),
  pushUndo: jest.fn(),
  setSaveErrors: jest.fn(),
  clearSaveError: jest.fn(),
  discardAll: jest.fn(),
  markClean: jest.fn(),
  markSaved: jest.fn(),
  stagePayeeMerge: jest.fn(),
  clearPendingPayeeMerges: jest.fn(),
  loadAccounts: jest.fn(),
  loadPayees: jest.fn(),
  loadCategories: jest.fn(),
  loadCategoryGroups: jest.fn(),
  loadRules: jest.fn(),
  loadSchedules: jest.fn(),
  loadTags: jest.fn(),
  setMergeDependency: jest.fn(),
  clearMergeDependencies: jest.fn(),
  undo: jest.fn(),
  redo: jest.fn(),
  clearHistory: jest.fn(),
};

const stagedRulesState: Record<string, { isDeleted: boolean }> = {};

jest.mock("../../store/staged", () => ({
  useStagedStore: Object.assign(() => ({}), {
    getState: () => ({
      rules: stagedRulesState,
      ...mutatorSpies,
    }),
  }),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

function makeFinding(partial: Partial<Finding> & { code: Finding["code"] }): Finding {
  return {
    code: partial.code,
    severity: partial.severity ?? "warning",
    title: partial.title ?? "A finding",
    message: partial.message ?? "a message",
    affected: partial.affected ?? [{ id: "rule-1", summary: "rule one" }],
    ...(partial.counterpart ? { counterpart: partial.counterpart } : {}),
  };
}

beforeEach(() => {
  refreshMock.mockReset();
  for (const spy of Object.values(mutatorSpies)) spy.mockReset();
  for (const k of Object.keys(stagedRulesState)) delete stagedRulesState[k];
});

it("renders, filters, refreshes, and jump-to-rule without invoking ANY staged-store mutator", () => {
  const findings: Finding[] = [
    makeFinding({
      code: "RULE_MISSING_PAYEE",
      severity: "error",
      title: "Error one",
      affected: [{ id: "rule-err", summary: "rule err summary" }],
    }),
    makeFinding({
      code: "RULE_BROAD_MATCH",
      severity: "warning",
      title: "Warning one",
      affected: [{ id: "rule-warn", summary: "rule warn summary" }],
    }),
    makeFinding({
      code: "RULE_NEAR_DUPLICATE_PAIR",
      severity: "info",
      title: "Info one",
      affected: [{ id: "rule-info", summary: "rule info summary" }],
    }),
  ];
  const summary = { error: 1, warning: 1, info: 1, total: 3 };

  hookResult = {
    report: {
      runAt: "2026-04-23T00:00:00.000Z",
      findings,
      summary,
      workingSetSignature: "sig-1",
      ruleCount: 3,
    },
    running: false,
    error: null,
    stale: false,
    refresh: refreshMock,
  };

  // Pretend every referenced rule still exists so jump-to-rule navigates rather than toasts.
  for (const f of findings) {
    for (const r of f.affected) {
      stagedRulesState[r.id] = { isDeleted: false };
    }
  }

  render(<RuleDiagnosticsView />);

  // 1. Click the Errors severity pill, then click All to reset.
  const errorsPill = screen.getAllByText("Errors").find(
    (el) => el.tagName === "BUTTON"
  ) as HTMLButtonElement;
  fireEvent.click(errorsPill);
  const allPill = screen.getAllByText("All").find(
    (el) => el.tagName === "BUTTON"
  ) as HTMLButtonElement;
  fireEvent.click(allPill);

  // 2. Type into the search box, then clear it.
  const searchInput = screen.getByLabelText("Search findings by rule");
  fireEvent.change(searchInput, { target: { value: "rule" } });
  fireEvent.change(searchInput, { target: { value: "" } });

  // 3. Click Refresh.
  fireEvent.click(screen.getByLabelText("Refresh rule diagnostics"));

  // 3. Click each finding's rule summary link.
  for (const f of findings) {
    const link = screen.getByLabelText(`Open rule: ${f.affected[0].summary}`);
    fireEvent.click(link);
  }

  // Verify zero mutators were called.
  for (const [name, spy] of Object.entries(mutatorSpies)) {
    expect(spy).not.toHaveBeenCalled();
    if (spy.mock.calls.length > 0) {
      // Surface a meaningful message if the assertion ever regresses.
      throw new Error(`Mutator ${name} was unexpectedly called by the diagnostics flow`);
    }
  }
});
