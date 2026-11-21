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

// jsdom does not measure layout or provide ResizeObserver.
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

const mockUseBudgetOverview = useBudgetOverview as jest.MockedFunction<typeof useBudgetOverview>;

const loadedStats: BudgetOverviewStats = {
  transactions: 17,
  accounts: 12,
  payees: 30,
  categories: 31,
  rules: 9,
  schedules: 3,
};

const loadedSnapshot: BudgetOverviewSnapshot = {
  stats: loadedStats,
  details: { closedAccounts: 2, transferPayees: 12, hiddenCategories: 5, completedSchedules: 1 },
  budgetMode: "Envelope",
  budgetingSince: "Jan 2019",
};

function buildHookResult(overrides: Partial<UseBudgetOverviewResult> = {}): UseBudgetOverviewResult {
  return {
    snapshot: loadedSnapshot,
    isLoading: false,
    isError: false,
    hasPartialFailure: false,
    dataUpdatedAt: Date.now(),
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
          mode: "http-api",
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

  it("shows loading placeholders for all snapshot metrics while data is being fetched", () => {
    mockUseBudgetOverview.mockReturnValue(
      buildHookResult({ snapshot: null, isLoading: true })
    );

    render(<BudgetOverviewView />);

    expect(screen.getAllByLabelText("Loading snapshot metric")).toHaveLength(8);
  });

  it("keeps the figures, dimmed, while a manual refresh is in progress and updates the timestamp on success", async () => {
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
    // The old figures stay readable instead of eight placeholders.
    expect(screen.queryByLabelText("Loading snapshot metric")).not.toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();

    await act(async () => {
      resolveRefresh?.({ ok: true, hasPartialFailure: false });
    });

    expect(screen.getByText("Updated just now")).toBeInTheDocument();
  });

  it("labels cached statistics with the time they were read, not the time they are shown", () => {
    mockUseBudgetOverview.mockReturnValue(buildHookResult({ dataUpdatedAt: Date.now() - 5 * 60_000 }));

    render(<BudgetOverviewView />);

    expect(screen.getByText("Last refreshed 5m ago")).toBeInTheDocument();
    expect(screen.queryByText("Updated just now")).not.toBeInTheDocument();
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

  it("names what the counts include, and marks a figure that could not be read instead of showing it as loading", () => {
    mockUseBudgetOverview.mockReturnValue(
      buildHookResult({ snapshot: { ...loadedSnapshot, stats: { ...loadedStats, payees: null } }, hasPartialFailure: true })
    );

    render(<BudgetOverviewView />);

    expect(screen.getByText("2 closed")).toBeInTheDocument();
    expect(screen.getByText("5 hidden")).toBeInTheDocument();
    expect(screen.getByText("3 from schedules")).toBeInTheDocument();
    expect(screen.getByText("First transaction")).toBeInTheDocument();
    expect(screen.getByLabelText("Could not be read. Press Refresh to try again.")).toHaveTextContent("-");
    expect(screen.getByText(/Some figures could not be read/)).toBeInTheDocument();
  });

  it("moves the timestamp on when the statistics are read again without the Refresh button", () => {
    mockUseBudgetOverview.mockReturnValue(buildHookResult({ dataUpdatedAt: Date.now() - 10 * 60_000 }));
    const { rerender } = render(<BudgetOverviewView />);
    expect(screen.getByText("Last refreshed 10m ago")).toBeInTheDocument();

    // A Save elsewhere reloads the statistics.
    mockUseBudgetOverview.mockReturnValue(buildHookResult({ dataUpdatedAt: Date.now() }));
    rerender(<BudgetOverviewView />);
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
  });
});
