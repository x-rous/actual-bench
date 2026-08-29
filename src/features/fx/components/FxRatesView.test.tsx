import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FxRatesView } from "./FxRatesView";
import { listFxPairs, listFxRates } from "../lib/fxApi";
import { listFlows } from "../../sync/lib/syncApi";

jest.mock("../lib/fxApi", () => ({
  listFxPairs: jest.fn(),
  listFxRates: jest.fn(),
  addManualFxRate: jest.fn(),
  fillFxRange: jest.fn(),
  fxRecalcImpact: jest.fn(),
}));
jest.mock("../../sync/lib/syncApi", () => ({ listFlows: jest.fn() }));
jest.mock("./FxImportPanel", () => ({ FxImportPanel: () => null }));

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FxRatesView />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (listFlows as jest.Mock).mockResolvedValue({ flows: [] });
  (listFxRates as jest.Mock).mockResolvedValue({ rates: [] });
});

describe("which pairs the page knows about", () => {
  it("shows a pair that only exists because rates were saved for it", async () => {
    // No flow converts through it: it was set up on this page to prepare rates
    // ahead of one. It used to disappear on the next page load.
    (listFxPairs as jest.Mock).mockResolvedValue({ pairs: [{ base: "EUR", quote: "USD" }] });

    renderView();

    expect(await screen.findByRole("button", { name: "EUR → USD" })).toBeInTheDocument();
  });

  it("says the pairs could not be read rather than claiming there are none", async () => {
    // "Nothing here" and "we could not look" are different answers, and saying
    // the first when the second is true hides rates that exist.
    (listFxPairs as jest.Mock).mockRejectedValue(new Error("network"));

    renderView();

    expect(await screen.findByText("Could not load your currency pairs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No currency conversion set up yet")).not.toBeInTheDocument();
  });

  it("still shows the empty state when the registry really is empty", async () => {
    (listFxPairs as jest.Mock).mockResolvedValue({ pairs: [] });

    renderView();

    expect(await screen.findByText("No currency conversion set up yet")).toBeInTheDocument();
  });

  it("waits for both sources before deciding the page is empty", async () => {
    // The flow query finishing first with nothing must not flash the empty
    // state over a pair the other request is about to deliver.
    let deliverPairs: (value: { pairs: { base: string; quote: string }[] }) => void = () => {};
    (listFxPairs as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        deliverPairs = resolve;
      })
    );

    renderView();

    await waitFor(() => expect(listFlows).toHaveBeenCalled());
    expect(screen.queryByText("No currency conversion set up yet")).not.toBeInTheDocument();

    deliverPairs({ pairs: [{ base: "GBP", quote: "USD" }] });
    expect(await screen.findByRole("button", { name: "GBP → USD" })).toBeInTheDocument();
  });
});
