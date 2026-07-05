import { cleanup, render, screen } from "@testing-library/react";
import { QueryWorkspace } from "./QueryWorkspace";
import { useConnectionStore, type BrowserApiConnection } from "@/store/connection";

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
    render(<QueryWorkspace />);

    expect(screen.getByRole("heading", { name: "ActualQL Queries" })).toBeInTheDocument();
    expect(
      screen.queryByText("ActualQL Queries need HTTP API Server mode")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });
});
