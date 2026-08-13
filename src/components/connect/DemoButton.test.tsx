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

  it("registers both budgets and opens the Envelope demo", async () => {
    render(<DemoButton />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Try the live demo" })
    );

    await waitFor(() => {
      const { instances, activeInstanceId } = useConnectionStore.getState();
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
        label: "Live Demo - Envelope",
        budgetSyncId: "envelope-sync-id",
      });
    });
    expect(mockPush).toHaveBeenCalledWith("/overview");
  });
});
