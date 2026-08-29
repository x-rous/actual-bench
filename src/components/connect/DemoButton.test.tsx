import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DemoButton } from "./DemoButton";
import { useConnectionStore } from "@/store/connection";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("DemoButton", () => {
  beforeEach(() => {
    mockPush.mockReset();
    useConnectionStore.getState().clearAll();
    sessionStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        baseUrl: "https://demo.example.com",
        apiKey: "public-demo-key",
        budgets: [
          {
            label: "Live Demo - Envelope",
            budgetSyncId: "envelope-sync-id",
          },
          {
            label: "Live Demo - Tracking",
            budgetSyncId: "tracking-sync-id",
          },
        ],
      }),
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("offers a button per budget mode, named for the mode rather than the budget", async () => {
    render(<DemoButton />);

    // "Live Demo - Envelope" is the right name for a connection and the wrong
    // one for a button.
    expect(await screen.findByRole("button", { name: "Envelope demo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tracking demo" })).toBeInTheDocument();
  });

  it("opens the mode that was chosen, and registers both either way", async () => {
    render(<DemoButton />);

    fireEvent.click(await screen.findByRole("button", { name: "Tracking demo" }));

    await waitFor(() => {
      const { instances, activeInstanceId } = useConnectionStore.getState();
      // Both are registered: the other mode stays one budget switch away.
      expect(instances).toHaveLength(2);
      expect(instances).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Live Demo - Envelope",
            budgetSyncId: "envelope-sync-id",
          }),
          expect.objectContaining({
            label: "Live Demo - Tracking",
            budgetSyncId: "tracking-sync-id",
          }),
        ])
      );
      expect(instances.find((instance) => instance.id === activeInstanceId)).toMatchObject({
        label: "Live Demo - Tracking",
        budgetSyncId: "tracking-sync-id",
      });
    });
    expect(mockPush).toHaveBeenCalledWith("/overview");
  });

  it("opens the Envelope demo when that is the one chosen", async () => {
    render(<DemoButton />);

    fireEvent.click(await screen.findByRole("button", { name: "Envelope demo" }));

    await waitFor(() => {
      const { instances, activeInstanceId } = useConnectionStore.getState();
      expect(instances.find((instance) => instance.id === activeInstanceId)).toMatchObject({
        budgetSyncId: "envelope-sync-id",
      });
    });
  });

  it("keeps a budget's own name when it does not carry the demo prefix", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        baseUrl: "https://demo.example.com",
        apiKey: "public-demo-key",
        budgets: [
          { label: "Household", budgetSyncId: "a" },
          { label: "Live Demo - Tracking", budgetSyncId: "b" },
        ],
      }),
    });

    render(<DemoButton />);

    expect(await screen.findByRole("button", { name: "Household demo" })).toBeInTheDocument();
  });

  it("renders nothing when the deployment is not a demo", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });

    const { container } = render(<DemoButton />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
