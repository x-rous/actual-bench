import { fireEvent, render, screen } from "@testing-library/react";
import { downloadCsv } from "@/lib/csv";
import { ChartCard } from "./ChartCard";

jest.mock("@/lib/csv", () => ({ downloadCsv: jest.fn() }));
jest.mock("./ChartCanvas", () => ({ __esModule: true, default: () => <div data-testid="canvas" /> }));

const props = {
  id: "test", title: "Your financial journey", csvScope: [["Period", "Last 6 months"]] as [string, string][],
  series: [{ label: "Net worth", color: "red" }, { label: "Cash & bank", color: "blue" }],
  points: [
    { label: "Sep 2026", partial: false, values: [null, null] },
    { label: "Oct 2026", partial: false, values: [123_456_78, 5_000_00] },
    { label: "Nov 2026", partial: true, values: [124_000_00, 4_900_00] },
  ],
};

beforeEach(() => { sessionStorage.clear(); jest.clearAllMocks(); });

describe("chart card", () => {
  it("shows the exact figures in a table, with unavailable months as gaps and partial months marked", () => {
    render(<ChartCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Sep 2026");
    expect(rows[1].querySelectorAll("td")[0]).toHaveTextContent("-");
    expect(rows[2]).toHaveTextContent("123,456.78");
    expect(rows[3]).toHaveTextContent("Nov 2026partial");
    expect(rows[3]).toHaveTextContent("124,000.00");
  });

  it("offers a legend and the three modes, with the chart modes sharing one canvas", async () => {
    render(<ChartCard {...props} />);
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("Net worth");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["Line", "Bars", "Table"]));
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bars" }));
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
  });

  it("exports what is shown, with its scope, marking gaps instead of writing zero", () => {
    render(<ChartCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Your financial journey as CSV" }));
    expect(downloadCsv).toHaveBeenCalledWith("financial-insights-test.csv", [
      ["Financial Insights", "Your financial journey"], ["Period", "Last 6 months"], [], ["Month", "Net worth", "Cash & bank"],
      ["Sep 2026", "unavailable", "unavailable"], ["Oct 2026", "123456.78", "5000.00"], ["Nov 2026 (partial)", "124000.00", "4900.00"],
    ]);
  });
});
