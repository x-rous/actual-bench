import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { progressView, type ProgressView } from "@/lib/financial-insights/progress";
import type { ScheduleInput } from "@/lib/financial-insights/debt";
import { AMOUNTS_MINOR, AMOUNTS_TEXT, NAMES, chk, factsOf, home, owned, inputOf, ltvTen, months, richFacts, row } from "@/lib/financial-insights/testing/progressFixture";
import { ProgressTabHarness as ProgressTab } from "./testing/ProgressTabHarness";

const toast = { success: jest.fn(), error: jest.fn() };
jest.mock("sonner", () => ({ toast: { success: (m: string) => toast.success(m), error: (m: string) => toast.error(m) } }));

const MONTH_NAME = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b20\d\d\b/;

function everything(): ProgressView {
  const schedules: ScheduleInput[] = [{ accountId: "mortgage", state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate: "2036-03-01" }, { accountId: "car", state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate: "2027-05-01" }];
  const input = inputOf(richFacts(), { schedules, equity: [home("a", ltvTen), home("b", ltvTen.map((v) => v + 5), "other-asset")] });
  // The fixture's car loan is paid off; give the buffer a ready value so every card shows.
  return progressView({ ...input, buffer: { state: "ready", value: { months: 4.2, monthsWithAccessible: 6.8 } as never } });
}

beforeEach(() => { sessionStorage.clear(); jest.clearAllMocks(); });

describe("the Progress tab", () => {
  it("shows every card with its words and a chart, under the header lines", () => {
    render(<ProgressTab view={everything()} />);
    for (const name of ["Net worth journey", "Debt payoff progress", "Property value & LTV", "Asset value & LTV", "Asset composition", "Savings rate", "Savings consistency", "Cash buffer journey", "Cash buffer"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Milestones" })).not.toBeInTheDocument();
    expect(screen.getByText(/Cards to share your progress\. They show shapes, percentages and months, never amounts\./)).toBeInTheDocument();
    expect(screen.getByText(/To see the amounts behind a card, open the tab it comes from: Summary, Loans & cards or Property & assets\./)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Download PNG of / })).toHaveLength(9);
    // The cards are in this order.
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")).filter((n) => n !== "Notifications")).toEqual(["Net worth journey", "Debt payoff progress", "Property value & LTV", "Asset value & LTV", "Asset composition", "Savings rate", "Savings consistency", "Cash buffer journey", "Cash buffer"]);
    for (const name of ["Show dates", "Show text"]) expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Footer" })).not.toBeInTheDocument();
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
    for (const word of words) expect(word).toMatch(/^(0|0%|100%|80%|12 months|\d+ months|Start|End of period|Today|Cash|Investments|Property|Other|Goal|Value|Loan-to-value|\d+\.\d%|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d)$/);
  });

  it("replaces every month name with Month N when dates are hidden, on the tab itself", () => {
    const { container, unmount } = render(<ProgressTab view={everything()} />);
    expect(container.textContent).toMatch(MONTH_NAME);
    unmount();
    sessionStorage.setItem("filters:financial-insights-progress", JSON.stringify({ showDates: false }));
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
    // The switch is on the tab, not on a card.
    expect(within(worth).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("takes the lines of words and the percentage marks off every chart card with the Show text switch, and keeps their pictures", () => {
    const { container } = render(<ProgressTab view={everything()} />);
    expect(screen.getAllByText(/Savings rate 21\.3% over the period/).length).toBeGreaterThan(0);
    expect([...container.querySelectorAll("svg text")].some((t) => /%$/.test(t.textContent ?? ""))).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Show text" }));
    for (const gone of [/over the period/, /months of spending covered/, /Lower \d+ months in a row/, /You own/, /LTV (down|up)/, /Best month/, /Dashed line/]) expect(screen.queryByText(gone)).not.toBeInTheDocument();
    // No percentage mark is left on a chart, except the loan-to-value of a property, which is always there; the month names and the gauge's months stay.
    const marks = (root: ParentNode) => [...root.querySelectorAll("svg text")].filter((t) => /%/.test(t.textContent ?? "")).map((t) => t.textContent);
    expect(marks(screen.getByRole("region", { name: "Savings rate" }))).toEqual([]);
    expect(marks(screen.getByRole("region", { name: "Asset composition" }))).toEqual([]);
    expect(marks(screen.getByRole("region", { name: "Property value & LTV" })).sort()).toEqual(["0%", "100%", "61.4%", "80%"]);
    expect(marks(screen.getByRole("region", { name: "Asset value & LTV" })).sort()).toEqual(["0%", "100%", "66.4%", "80%"].sort());
    // Not in the page for a screen reader either: the charts keep only their titles.
    expect(container.textContent).not.toMatch(/over the period|You own|Best month|months of spending covered/);
    expect(screen.getByRole("region", { name: "Savings rate" })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("filters:financial-insights-progress")!)).toMatchObject({ showText: false });
    fireEvent.click(screen.getByRole("switch", { name: "Show text" }));
    expect(screen.getAllByText(/over the period/).length).toBeGreaterThan(0);
  });

  it("keeps the reason an unavailable buffer gives when the text is off", () => {
    sessionStorage.setItem("filters:financial-insights-progress", JSON.stringify({ showText: false }));
    render(<ProgressTab view={progressView(inputOf(richFacts(), { buffer: { state: "unavailable", reason: "There is no regular spending to measure against" } }))} />);
    expect(screen.getByText("There is no regular spending to measure against")).toBeInTheDocument();
  });

  it("shows the share-safe warning on a savings rate Summary flags, and hides it with the text", () => {
    const input = inputOf(richFacts());
    const view = progressView({ ...input, summary: { ...input.summary, savingsRate: { state: "ready", value: 21.3, warning: "2 entries (987,654.32)" } } });
    const { container } = render(<ProgressTab view={view} />);
    expect(screen.getByText("Some entries may be counted twice; see Summary")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("987");
    fireEvent.click(screen.getByRole("switch", { name: "Show text" }));
    expect(screen.queryByText("Some entries may be counted twice; see Summary")).not.toBeInTheDocument();
  });

  it("shows the three new cards with their words and pictures", () => {
    render(<ProgressTab view={everything()} />);
    const consistency = screen.getByRole("region", { name: "Savings consistency" });
    expect(within(consistency).getAllByText("9 of 10 months saved").length).toBeGreaterThan(0);
    expect(within(consistency).getByText("Last 10 complete months")).toBeInTheDocument();
    // One square for each month, with a mark inside it that says saved or short.
    expect(consistency.querySelectorAll("svg g path")).toHaveLength(10);
    const composition = screen.getByRole("region", { name: "Asset composition" });
    expect(within(composition).getAllByText(/Largest now: Cash/).length).toBeGreaterThan(0);
    for (const name of ["Start", "End of period", "Cash", "Investments", "Property", "Other"]) expect(within(composition).getAllByText(name).length).toBeGreaterThan(0);
    const journey = screen.getByRole("region", { name: "Cash buffer journey" });
    expect(within(journey).getAllByText(/^Cover up from /).length).toBeGreaterThan(0);
  });

  it("takes the words off the new cards with Show text, and keeps their pictures", () => {
    render(<ProgressTab view={everything()} />);
    fireEvent.click(screen.getByRole("switch", { name: "Show text" }));
    for (const gone of [/months saved/, /positive months/, /Largest now/, /^Cover up from/]) expect(screen.queryByText(gone)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Savings consistency" }).querySelectorAll("svg g path")).toHaveLength(10);
    expect(screen.getByRole("region", { name: "Asset composition" }).querySelectorAll("svg rect").length).toBeGreaterThan(4);
  });

  it("draws a property's value as a shaded shape behind its loan-to-value line, with a key, and shows no amount", () => {
    const { container } = render(<ProgressTab view={everything()} />);
    const card = screen.getByRole("region", { name: "Property value & LTV" });
    for (const word of ["Value", "Loan-to-value", "0%", "100%", "80%"]) expect(within(card).getAllByText(word).length).toBeGreaterThan(0);
    expect(card.querySelectorAll('svg path[fill-opacity="0.2"]').length).toBeGreaterThan(0);
    expect(within(card).getAllByText(/^Value up 16\.6% over the period/).length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("543210");
  });

  it("shows a property with no loan as its value alone, titled by kind, and no card without a property", () => {
    const view = progressView(inputOf(richFacts(), { equity: [owned("a", [100, 110, 120, 130, 140, 150, 160, 170, 180, 190])] }));
    render(<ProgressTab view={view} />);
    const card = screen.getByRole("region", { name: "Property value" });
    expect(within(card).queryByText("Loan-to-value")).not.toBeInTheDocument();
    expect(within(card).getAllByText("Value up 90.0% over the period").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: /LTV/ })).not.toBeInTheDocument();
  });

  it("starts with Show dates and Show text both on when the page is opened for the first time, and keeps a later choice", () => {
    const { unmount } = render(<ProgressTab view={everything()} />);
    for (const name of ["Show dates", "Show text"]) expect(screen.getByRole("switch", { name })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText(/over the period/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: "Show text" }));
    unmount();
    render(<ProgressTab view={everything()} />);
    expect(screen.getByRole("switch", { name: "Show text" })).toHaveAttribute("aria-checked", "false");
  });

  it("says once that property cards are unavailable, and keeps the other cards", () => {
    render(<ProgressTab view={progressView(inputOf(richFacts(), { equity: [], equityFailed: true }))} />);
    expect(screen.getAllByText("Property cards are unavailable because property values could not be read.")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Savings rate" })).toBeInTheDocument();
  });

  it("notes a savings month drawn at −100% on the card", () => {
    const f = factsOf([chk], months(1, 10).flatMap((m) => [row(m, "chk", 1_000, { categoryId: "salary" }), row(m, "chk", -5_000, { categoryId: "food" })]));
    render(<ProgressTab view={progressView(inputOf(f))} />);
    expect(screen.getByText("Months below −100% are drawn at −100%")).toBeInTheDocument();
  });

  it("picks the debt choice on the card", () => {
    render(<ProgressTab view={everything()} />);
    const debt = screen.getByRole("region", { name: "Debt payoff progress" });
    expect(within(debt).getByRole("button", { name: "Credit cards", pressed: true })).toBeInTheDocument();
    fireEvent.click(within(debt).getByRole("button", { name: "Loans" }));
    expect(within(debt).getByRole("button", { name: "Loans", pressed: true })).toBeInTheDocument();
    expect(within(debt).getAllByText(/paid off since the peak in Jan 2026/).length).toBeGreaterThan(0);
  });

  it("gives the reason, never a zero, for a buffer that cannot be worked out, and says so while property values are read", () => {
    const input = inputOf(richFacts(), { equity: null, buffer: { state: "unavailable", reason: "There is no regular spending to measure against" } });
    render(<ProgressTab view={progressView(input)} />);
    expect(screen.getByText("There is no regular spending to measure against")).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 months/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reading property values…");
  });
});
