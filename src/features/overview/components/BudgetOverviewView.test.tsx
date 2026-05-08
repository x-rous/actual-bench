import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConnectionStore } from "@/store/connection";
import type {
  BudgetOverviewSnapshot,
  BudgetOverviewStats,
  OverviewRefreshResult,
  UseBudgetOverviewResult,
} from "../types";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("../hooks/useBudgetOverview", () => ({
  useBudgetOverview: jest.fn(),
}));

import { BudgetOverviewView } from "./BudgetOverviewView";
import { useBudgetOverview } from "../hooks/useBudgetOverview";

const mockUseBudgetOverview = useBudgetOverview as jest.MockedFunction<typeof useBudgetOverview>;

const loadedStats: BudgetOverviewStats = {
  transactions: 17,
  accounts: 12,
  payees: 30,
  categoryGroups: 4,
  categories: 31,
  rules: 9,
  schedules: 3,
};

const loadedSnapshot: BudgetOverviewSnapshot = {
  stats: loadedStats,
  budgetMode: "Envelope",
  budgetingSince: "Jan 2019",
};

function buildHookResult(overrides: Partial<UseBudgetOverviewResult> = {}): UseBudgetOverviewResult {
  return {
    snapshot: loadedSnapshot,
    isLoading: false,
    isError: false,
    hasPartialFailure: false,
    refresh: jest.fn().mockResolvedValue({
      ok: true,
      hasPartialFailure: false,
    }),
    ...overrides,
  };
}

describe("BudgetOverviewView", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-12T12:00:00Z"));
    useConnectionStore.setState({
      instances: [
        {
          id: "conn-1",
          label: "Household Budget",
          baseUrl: "http://localhost:5006",
          apiKey: "key",
          budgetSyncId: "budget-1",
        },
      ],
      activeInstanceId: "conn-1",
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    sessionStorage.clear();
    act(() => {
      useConnectionStore.setState({ instances: [], activeInstanceId: null });
    });
    mockUseBudgetOverview.mockReset();
  });

  it("shows the selected budget name immediately and a loading badge during budget switches", () => {
    mockUseBudgetOverview.mockReturnValue(
      buildHookResult({ snapshot: null, isLoading: true })
    );

    render(<BudgetOverviewView />);

    expect(screen.getByText("Household Budget")).toBeInTheDocument();
    expect(screen.getByText("Loading budget")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Loading snapshot metric")).toHaveLength(8);
  });

  it("shows loading placeholders while a manual refresh is in progress and updates the timestamp on success", async () => {
    let resolveRefresh: ((value: OverviewRefreshResult) => void) | undefined;
    const refresh = jest.fn(
      () =>
        new Promise<OverviewRefreshResult>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    mockUseBudgetOverview.mockReturnValue(buildHookResult({ refresh }));

    render(<BudgetOverviewView />);

    await waitFor(() => {
      expect(screen.getByText("Updated just now")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByRole("button", { name: "Refreshing" })).toBeDisabled();
    expect(screen.getAllByLabelText("Loading snapshot metric")).toHaveLength(8);

    await act(async () => {
      resolveRefresh?.({ ok: true, hasPartialFailure: false });
    });

    expect(screen.getByText("Updated just now")).toBeInTheDocument();
  });

  it("keeps the previous refresh timestamp when refresh completes with partial failures", async () => {
    const refresh = jest.fn().mockResolvedValue({
      ok: false,
      hasPartialFailure: true,
    });

    mockUseBudgetOverview.mockReturnValue(buildHookResult({ refresh }));

    render(<BudgetOverviewView />);

    await waitFor(() => {
      expect(screen.getByText("Updated just now")).toBeInTheDocument();
    });

    act(() => {
      jest.advanceTimersByTime(60000);
    });

    expect(screen.getByText("Last refreshed 1m ago")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Last refreshed 1m ago")).toBeInTheDocument();
    });
  });
});
