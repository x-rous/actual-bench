import { render, screen } from "@testing-library/react";
import { useConnectionHealth } from "./useConnectionHealth";
import { useConnectionStore, type BrowserApiConnection } from "@/store/connection";

const directConnection: BrowserApiConnection = {
  id: "direct-1",
  label: "Direct Budget",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "secret",
  budgetSyncId: "budget-1",
};

function Probe() {
  const health = useConnectionHealth();
  return <div>{health.status}</div>;
}

describe("useConnectionHealth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useConnectionStore.setState({
      instances: [directConnection],
      activeInstanceId: directConnection.id,
    });
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => {
    useConnectionStore.setState({ instances: [], activeInstanceId: null });
    jest.restoreAllMocks();
  });

  it("reports Direct sessions without pinging the HTTP API proxy", () => {
    render(<Probe />);

    expect(screen.getByText("direct")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
