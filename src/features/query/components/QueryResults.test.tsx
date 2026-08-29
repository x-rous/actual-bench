import { render, screen } from "@testing-library/react";
import { QueryResults } from "./QueryResults";

jest.mock("sonner", () => ({
  toast: Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn(), warning: jest.fn() }),
}));

const rows = [
  { id: "t-1", date: "2026-08-14", amount: -4429, "payee.name": "Neighborhood Pet Supply" },
  { id: "t-2", date: "2026-08-14", amount: -6355, "payee.name": "Chevron" },
];

/**
 * The results toolbar carries four tabs, four measurements and up to four
 * actions. Beside an open examples panel they did not fit one line: the
 * measurements ran over the last tab and the final action was clipped off the
 * edge - at 1440px, which is an ordinary laptop.
 */
describe("the results toolbar", () => {
  it("keeps every tab, measurement and action on screen together", () => {
    render(
      <QueryResults
        result={rows}
        isRunning={false}
        error={null}
        execTime={248}
        payloadBytes={3891}
        lastRequest={{
          mode: "http-api",
          query: { table: "transactions" } as never,
          rawQuery: '{"table":"transactions"}',
          baseUrl: "https://api.example.com",
          budgetSyncId: "b-1",
          apiKey: "key",
        }}
      />
    );

    for (const tab of ["Table", "Raw JSON", "Scalar", "Tree"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeInTheDocument();
    }
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("248ms")).toBeInTheDocument();
    for (const action of ["Export CSV", "Copy JSON", "Copy HTTP cURL", "cURL + secrets"]) {
      expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    }
  });

  it("wraps rather than overlapping when the row runs out of width", () => {
    // jsdom cannot measure layout, so this pins the mechanism: the tabs never
    // compress, and the actions move to a second line instead of over them.
    const { container } = render(
      <QueryResults result={rows} isRunning={false} error={null} execTime={248} payloadBytes={3891} />
    );

    const bar = container.querySelector(".border-b");
    expect(bar?.className).toContain("flex-wrap");
    expect(bar?.firstElementChild?.className).toContain("shrink-0");
  });

  it("shows no measurements before a query has run", () => {
    render(<QueryResults result={null} isRunning={false} error={null} />);

    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });
});
