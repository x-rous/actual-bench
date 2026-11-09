import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { progressView, type ProgressView } from "@/lib/financial-insights/progress";
import type { ScheduleInput } from "@/lib/financial-insights/debt";
import { AMOUNTS_MINOR, AMOUNTS_TEXT, NAMES, chk, factsOf, home, inputOf, ltvTen, months, richFacts, row } from "@/lib/financial-insights/testing/progressFixture";
import { ProgressTabHarness as ProgressTab } from "./testing/ProgressTabHarness";

const toast = { success: jest.fn(), error: jest.fn() };
jest.mock("sonner", () => ({ toast: { success: (m: string) => toast.success(m), error: (m: string) => toast.error(m) } }));

const MONTH_NAME = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b20\d\d\b/;

function everything(): ProgressView {
  const schedules: ScheduleInput[] = [{ accountId: "mortgage", state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate: "2036-03-01" }, { accountId: "car", state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate: "2027-05-01" }];
  const input = inputOf(richFacts(), { schedules, equity: [home("a", ltvTen), home("b", ltvTen.map((v) => v + 5), "vehicle")] });
  // The fixture's car loan is paid off; give the buffer a ready value so every card shows.
  return progressView({ ...input, buffer: { state: "ready", value: { months: 4.2, monthsWithAccessible: 6.8 } as never } });
}

beforeEach(() => { sessionStorage.clear(); jest.clearAllMocks(); });

describe("the Progress tab", () => {
  it("shows every card with its words and a chart, under the header lines", () => {
    render(<ProgressTab view={everything()} />);
    for (const name of ["Net worth journey", "Debt payoff progress", "Savings rate", "Cash buffer", "Home", "Vehicle", "Milestones"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByText(/Cards to share your progress\. They show shapes, percentages and months, never amounts\./)).toBeInTheDocument();
    expect(screen.getByText(/To see the amounts behind a card, open the tab it comes from: Summary, Loans & cards or Property & assets\./)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Share / })).toHaveLength(7);
    expect(screen.getByText("4.2 months of spending covered")).toBeInTheDocument();
    expect(screen.getByText("As of today")).toBeInTheDocument();
    // Charts name their shape for a screen reader and offer no value to hover.
    expect(screen.getByRole("img", { name: /^Net worth journey:/ })).toBeInTheDocument();
  });

  it("holds no fixture amount, no currency, and no account, loan or asset name anywhere in its text or its markup", () => {
    const { container } = render(<ProgressTab view={everything()} />);
    const text = `${container.textContent}\n${container.innerHTML}`;
    for (const minor of AMOUNTS_MINOR) expect(text).not.toContain(String(minor));
    for (const amount of AMOUNTS_TEXT) expect(text).not.toContain(amount);
    for (const name of NAMES) expect(text).not.toContain(name);
    expect(text).not.toMatch(/[$€£¥]|\b(USD|EUR|GBP)\b/);
    expect(container.querySelectorAll("title, [data-value], [aria-valuenow]")).toHaveLength(0);
    // Not one tick label: every text node in a chart is a month, a zero marker, a reference or a mark.
    const words = [...container.querySelectorAll("svg text")].map((t) => t.textContent ?? "");
    for (const word of words) expect(word).toMatch(/^(0|0%|100%|80%|12 months|\d+ months|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d)$/);
  });

  it("replaces every month name with Month N when dates are hidden, on the tab itself", () => {
    const { container, unmount } = render(<ProgressTab view={everything()} />);
    expect(container.textContent).toMatch(MONTH_NAME);
    unmount();
    sessionStorage.setItem("filters:financial-insights-progress", JSON.stringify({ showDates: false, footer: true }));
    const hidden = render(<ProgressTab view={everything()} />);
    const text = `${hidden.container.textContent}\n${[...hidden.container.querySelectorAll("svg text")].map((t) => t.textContent).join(" ")}`;
    expect(text).not.toMatch(MONTH_NAME);
    expect(text).toContain("Month 1");
    expect(text).toContain("Month 10");
    expect(screen.getAllByText("Highest point: Month 10").length).toBeGreaterThan(0);
  });

  it("switches dates for the whole tab from the switch at the top right of the tab, and keeps the choice", async () => {
    render(<ProgressTab view={everything()} />);
    const worth = screen.getByRole("region", { name: "Net worth journey" });
    expect(within(worth).getAllByText(/Highest point: Oct 2026/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: "Show dates" }));
    await waitFor(() => expect(within(worth).getAllByText("Highest point: Month 10").length).toBeGreaterThan(0));
    expect(worth.textContent).not.toMatch(MONTH_NAME);
    expect(JSON.parse(sessionStorage.getItem("filters:financial-insights-progress")!)).toMatchObject({ showDates: false });
    // The Share popover has no dates switch of its own.
    fireEvent.click(within(worth).getByRole("button", { name: "Share Net worth journey" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("switch", { name: "Show dates" })).not.toBeInTheDocument();
  });

  it("says once that home cards are unavailable, and keeps the other cards", () => {
    render(<ProgressTab view={progressView(inputOf(richFacts(), { equity: [], equityFailed: true }))} />);
    expect(screen.getAllByText("Home cards are unavailable because property values could not be read.")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Savings rate" })).toBeInTheDocument();
  });

  it("notes a savings month drawn at −100% on the card", () => {
    const f = factsOf([chk], months(1, 10).flatMap((m) => [row(m, "chk", 1_000, { categoryId: "salary" }), row(m, "chk", -5_000, { categoryId: "food" })]));
    render(<ProgressTab view={progressView(inputOf(f))} />);
    expect(screen.getByText("Months below −100% are drawn at −100%")).toBeInTheDocument();
  });

  it("picks the debt choice on the card, and offers all-time history from the milestones", () => {
    const seeAll = jest.fn();
    render(<ProgressTab view={everything()} onSeeAllTime={seeAll} />);
    const debt = screen.getByRole("region", { name: "Debt payoff progress" });
    expect(within(debt).getByRole("button", { name: "Credit cards", pressed: true })).toBeInTheDocument();
    fireEvent.click(within(debt).getByRole("button", { name: "Loans" }));
    expect(within(debt).getByRole("button", { name: "Loans", pressed: true })).toBeInTheDocument();
    expect(within(debt).getAllByText(/paid off since the peak in Jan 2026/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "See all time" }));
    expect(seeAll).toHaveBeenCalled();
  });

  it("gives the reason, never a zero, for a buffer that cannot be worked out, and says so while property values are read", () => {
    const input = inputOf(richFacts(), { equity: null, buffer: { state: "unavailable", reason: "There is no regular spending to measure against" } });
    render(<ProgressTab view={progressView(input)} />);
    expect(screen.getByText("There is no regular spending to measure against")).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 months/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reading property values…");
  });
});
