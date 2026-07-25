import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QueryWorkspace } from "./QueryWorkspace";
import { useConnectionStore, type BrowserApiConnection } from "@/store/connection";

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QueryWorkspace />
    </QueryClientProvider>,
  );
}

jest.mock("sonner", () => ({
  toast: Object.assign(jest.fn(), {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    dismiss: jest.fn(),
  }),
}));

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => function DynamicStub() { return null; },
}));

const directConnection: BrowserApiConnection = {
  id: "direct-1",
  label: "Direct Budget",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "secret",
  budgetSyncId: "budget-1",
};

describe("QueryWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Saved queries are now fetched from the app-DB route; stub it so the
    // workspace's TanStack query resolves to an empty list in the test env.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ savedQueries: [] })),
    }) as unknown as typeof fetch;
    useConnectionStore.setState({
      instances: [directConnection],
      activeInstanceId: directConnection.id,
    });
  });

  afterEach(() => {
    cleanup();
    useConnectionStore.setState({ instances: [], activeInstanceId: null });
    jest.restoreAllMocks();
  });

  it("opens the ActualQL workspace for Direct connections", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "ActualQL Queries" })).toBeInTheDocument();
    expect(
      screen.queryByText("ActualQL Queries need HTTP API Server mode")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });
});
