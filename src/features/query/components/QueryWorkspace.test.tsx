import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QueryWorkspace, shouldOfferUndo } from "./QueryWorkspace";
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

/*
 * Loading a query offers to undo so that picking an example cannot silently
 * discard something the user wrote. It offered unconditionally, and the common
 * path through this page is browsing examples without editing any of them - so
 * the offer arrived on every click, each time with nothing to give back.
 *
 * Tested as a rule rather than through the panel: the editor is a `next/dynamic`
 * stub in this environment, so a rendered test cannot put the user's own text
 * into it, and the only case it could exercise is the one where the answer is
 * already no.
 */
describe("shouldOfferUndo", () => {
  const EXAMPLE = '{"table":"transactions"}';

  it("says no while the editor holds exactly what was loaded into it", () => {
    expect(shouldOfferUndo(EXAMPLE, EXAMPLE)).toBe(false);
  });

  it("says yes once the user has changed it", () => {
    expect(shouldOfferUndo(EXAMPLE + '\n// mine', EXAMPLE)).toBe(true);
  });

  it("says no for an empty or whitespace-only editor", () => {
    expect(shouldOfferUndo("", EXAMPLE)).toBe(false);
    expect(shouldOfferUndo("   \n  ", EXAMPLE)).toBe(false);
  });

  it("says yes for the first edit made to the query the page opened with", () => {
    // The opening query is "loaded" too, so it is not the user's work until
    // they touch it - and then it is.
    expect(shouldOfferUndo("typed by hand", "")).toBe(true);
  });
});
