import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { progressView, type ProgressView } from "@/lib/financial-insights/progress";
import { AMOUNTS_MINOR, AMOUNTS_TEXT, NAMES, chk, factsOf, home, inputOf, ltvTen, months, richFacts, row } from "@/lib/financial-insights/testing/progressFixture";
import { serializeSvg } from "../lib/progressImage";
import { ProgressArt } from "./ProgressArt";
import { ProgressTabHarness as ProgressTab } from "./testing/ProgressTabHarness";

const toast = { success: jest.fn(), error: jest.fn() };
let mockTheme: string | undefined = "light";
jest.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: mockTheme }) }));
jest.mock("sonner", () => ({ toast: { success: (m: string) => toast.success(m), error: (m: string) => toast.error(m) } }));

/** The SVG namespace holds "2000", which is not a year. */
const noNamespace = (svg: string) => svg.replaceAll("http://www.w3.org/2000/svg", "");
const MONTH_NAME = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b20\d\d\b/;

function view(): ProgressView {
  const input = inputOf(richFacts(), { equity: [home("a", ltvTen)], schedules: [{ accountId: "mortgage", state: "ready", principalNext12Minor: 1, costNext12Minor: 1, payoffDate: "2036-03-01" }] });
  return progressView({ ...input, buffer: { state: "ready", value: { months: 4.2, monthsWithAccessible: 6.8 } as never } });
}

const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsText(blob); });

/** A canvas that records nothing and a picture that always loads: the SVG that would be drawn is what the test reads. */
let blobs: Blob[];
let downloads: string[];
function mockBrowser() {
  blobs = []; downloads = [];
  URL.createObjectURL = jest.fn((blob: Blob | MediaSource) => { blobs.push(blob as Blob); return "blob:progress"; });
  URL.revokeObjectURL = jest.fn();
  class FakeImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } }
  (global as unknown as { Image: unknown }).Image = FakeImage;
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: jest.fn() } as never);
  jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
}

beforeEach(() => { mockTheme = "light"; sessionStorage.clear(); jest.clearAllMocks(); mockBrowser(); });
afterEach(() => {
  jest.restoreAllMocks();
  // A test that fails halfway must not leave the clipboard, or ClipboardItem, set for the next one.
  delete (global as unknown as { ClipboardItem?: unknown }).ClipboardItem;
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

/** The tab, with the buttons at the top right of each card. */
function open() { render(<ProgressTab view={view()} />); }
const download = (card: string) => fireEvent.click(screen.getByRole("button", { name: `Download PNG of ${card}` }));
const copy = (card: string) => fireEvent.click(screen.getByRole("button", { name: `Copy image of ${card}` }));
/** The picture's text. The embedded icon is a fixed image, so it is cut out before the text is searched: its base64 could hold any digits by chance. */
const withoutIcon = (svg: string) => svg.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "data:icon");
const svgText = async () => readBlob(blobs.find((b) => b.type.startsWith("image/svg"))!);

describe("exporting a card", () => {
  it("draws a 1200 × 675 picture with the Actual Bench icon at its top left, and saves it as financial-insights-progress-<card>.png", async () => {
    open();
    download("Net worth journey");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Image downloaded"));
    expect(downloads).toEqual(["financial-insights-progress-net-worth.png"]);
    const svg = await svgText();
    // A picture that is well-formed: the namespace is declared once, so the browser can load it.
    expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="675"');
    expect(svg).toContain("Net worth journey");
    // The icon: an image of the app's own icon, 64 px, at the top left, with the title to its right.
    expect(svg).toMatch(/<image[^>]*href="data:image\/png;base64,[A-Za-z0-9+/=]{500,}"[^>]*x="60"[^>]*y="30"[^>]*width="64"[^>]*height="64"/);
    expect(svg).not.toContain("Made with Actual Bench");
  });

  it("carries no amount, no name, no currency, no title element, no data attribute and no accessible text", async () => {
    open();
    download("Net worth journey");
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    const svg = withoutIcon(await svgText());
    for (const minor of AMOUNTS_MINOR) expect(svg).not.toContain(String(minor));
    for (const amount of AMOUNTS_TEXT) expect(svg).not.toContain(amount);
    for (const name of NAMES) expect(svg).not.toContain(name);
    expect(svg).not.toMatch(/[$€£¥]|\b(USD|EUR|GBP)\b/);
    expect(svg).not.toMatch(/<title|<desc|data-|aria-|role=|<metadata/);
  });

  it("leaves the months out when dates are off, and keeps the icon", async () => {
    open();
    // Dates and text are switches for the whole tab, at its top right.
    fireEvent.click(screen.getByRole("switch", { name: "Show dates" }));
    expect(screen.queryByRole("switch", { name: "Footer" })).not.toBeInTheDocument();
    download("Savings rate");
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    const svg = await svgText();
    expect(svg).toContain("<image");
    expect(noNamespace(withoutIcon(svg))).not.toMatch(MONTH_NAME);
    expect(svg).toContain("Month 1");
  });

  it("leaves the lines of words and the percentage marks out of the picture when Show text is off, and gives the chart the room", async () => {
    open();
    fireEvent.click(screen.getByRole("switch", { name: "Show text" }));
    download("Property value & LTV");
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    const svg = await svgText();
    expect(svg).toContain("Property value");
    for (const gone of ["You own", "Value up", "LTV down"]) expect(svg).not.toContain(gone);
    // The loan-to-value stays on the chart: its scale, the 80% line and the latest figure at the end of the line.
    for (const kept of [">0%<", ">100%<", ">80%<", ">61.4%<"]) expect(svg).toContain(kept);
    expect(svg).toContain("<image");
  });

  it("is drawn in the theme the app is in, light or dark, with no theme choice of its own", async () => {
    mockTheme = "dark";
    open();
    expect(screen.queryByRole("button", { name: "Dark" })).not.toBeInTheDocument();
    download("Cash buffer");
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    expect(await svgText()).toContain('fill="#171717"');
  });

  it("is light when the app is light", async () => {
    open();
    download("Cash buffer");
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    expect(await svgText()).toContain('fill="#ffffff"');
  });

  it("stacks the notes of a savings card on separate lines at the foot of the picture", async () => {
    const input = inputOf(factsOf([chk], months(1, 10).flatMap((m, i) => [row(m, "chk", 1_000, { categoryId: "salary" }), row(m, "chk", i === 3 ? 5_000 : i === 4 ? -5_000 : -500, { categoryId: "food" })])));
    const flagged = progressView({ ...input, summary: { ...input.summary, savingsRate: { state: "ready", value: 20, warning: "x" } } });
    render(<ProgressTab view={flagged} />);
    download("Savings rate");
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    const svg = new DOMParser().parseFromString(await svgText(), "image/svg+xml");
    const notes = [...svg.querySelectorAll("text")].filter((t) => /^(Some entries|Months (above|below))/.test(t.textContent ?? ""));
    expect(notes.map((t) => t.textContent)).toEqual(["Some entries may be counted twice; see Summary", "Months below −100% are drawn at −100%", "Months above 100% are drawn at 100%"]);
    expect(new Set(notes.map((t) => t.getAttribute("y"))).size).toBe(3);
    expect(Math.max(...notes.map((t) => Number(t.getAttribute("y"))))).toBeLessThanOrEqual(675);
  });

  it("keeps the chart clear of a stack of four notes at the foot of a savings picture", async () => {
    const movement = [row("2026-01", "chk", 1_000, { categoryId: "salary" }), row("2026-01", "chk", 5_000, { categoryId: "food" }), row("2026-02", "chk", 1_000, { categoryId: "salary" }), row("2026-02", "chk", -5_000, { categoryId: "food" }), row("2026-03", "chk", -100, { categoryId: "food" }), row("2026-04", "chk", 1_000, { categoryId: "salary" })];
    const input = inputOf(factsOf([chk], movement), {}, ["2026-01", "2026-04"]);
    render(<ProgressTab view={progressView({ ...input, summary: { ...input.summary, savingsRate: { state: "ready", value: 20, warning: "x" } } })} />);
    download("Savings rate");
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    const doc = new DOMParser().parseFromString(await svgText(), "image/svg+xml");
    const notes = [...doc.querySelectorAll("text")].filter((t) => /^(Some entries|Months (above|below|with))/.test(t.textContent ?? ""));
    expect(notes).toHaveLength(4);
    const chart = [...doc.querySelectorAll("svg")].find((n) => n.getAttribute("viewBox") === "0 0 720 280" && n.parentElement === doc.documentElement)!;
    const bottom = Number(chart.getAttribute("y")) + Number(chart.getAttribute("height"));
    const highestNote = Math.min(...notes.map((t) => Number(t.getAttribute("y")))) - 14;
    expect(bottom).toBeLessThanOrEqual(highestNote);
  });

  it("puts Copy image and Download PNG on every card, and no Share popover", () => {
    open();
    for (const card of ["Net worth journey", "Asset composition", "Debt payoff progress", "Savings rate", "Savings consistency", "Cash buffer", "Cash buffer journey", "Property value & LTV"]) {
      expect(screen.getByRole("button", { name: `Download PNG of ${card}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Share / })).not.toBeInTheDocument();
  });

  it("exports the debt choice that is picked, every card in both themes and with dates on and off, none with an amount or a name", () => {
    const v = view();
    for (const card of v.cards) {
      const choices = card.kind === "debt" ? card.choices : [null];
      for (const choice of choices) for (const theme of ["light", "dark"] as const) for (const showDates of [true, false]) {
        let node: SVGSVGElement | null = null;
        const { unmount } = render(<ProgressArt card={card} choice={choice} options={{ showDates, showText: true, theme }} svgRef={(n) => { node = n; }} />);
        const serialized = serializeSvg(node!);
        expect(serialized).toContain("<image");
        const text = withoutIcon(serialized);
        for (const minor of AMOUNTS_MINOR) expect(text).not.toContain(String(minor));
        for (const name of NAMES) expect(text).not.toContain(name);
        expect(text).not.toMatch(/[$€£¥]|<title|data-/);
        if (!showDates) expect(noNamespace(text)).not.toMatch(MONTH_NAME);
        expect(text).not.toContain("Made with");
        // An ampersand in a title is written as an entity in the file.
        expect(text).toContain(card.title.replaceAll("&", "&amp;"));
        unmount();
      }
    }
  });

  it("tells the person when the picture cannot be made", async () => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    open();
    download("Cash buffer");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This browser cannot draw the picture"));
    expect(downloads).toEqual([]);
  });
});

describe("copying a card", () => {
  it("is not offered where the browser cannot put an image on the clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    delete (global as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    open();
    expect(screen.queryByRole("button", { name: /^Copy image/ })).not.toBeInTheDocument();
  });

  it("hands the clipboard the picture as a promise, inside the click, so Safari accepts the write", async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const items: Record<string, unknown>[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    (global as unknown as { ClipboardItem: unknown }).ClipboardItem = class { constructor(public data: Record<string, unknown>) { items.push(data); } };
    open();
    copy("Savings rate");
    // The write has already started when the click handler returns: nothing was awaited before it.
    expect(write).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    expect(items[0]["image/png"]).toBeInstanceOf(Promise);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Image copied"));
    delete (global as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("tells the person when the clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { write: jest.fn().mockRejectedValue(new Error("Not allowed")) }, configurable: true });
    (global as unknown as { ClipboardItem: unknown }).ClipboardItem = class { constructor(public data: Record<string, unknown>) {} };
    open();
    copy("Savings rate");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not allowed"));
    delete (global as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
});

describe("copying all the images", () => {
  const clipboard = () => {
    // Like a real clipboard: the write settles when the picture it was given settles, and fails if that fails.
    const write = jest.fn(async ([item]: { data: Record<string, unknown> }[]) => { await item.data["image/png"]; });
    const items: Record<string, unknown>[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    (global as unknown as { ClipboardItem: unknown }).ClipboardItem = class { constructor(public data: Record<string, unknown>) { items.push(data); } };
    return { write, items };
  };
  /** Records each canvas and what is drawn on it. */
  const canvases = () => {
    const drawn: { canvas: HTMLCanvasElement; draws: number; fills: string[] }[] = [];
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      const record = { canvas: this, draws: 0, fills: [] as string[] };
      drawn.push(record);
      return { drawImage: () => { record.draws++; }, fillRect: jest.fn(), set fillStyle(v: string) { record.fills.push(v); } } as never;
    });
    return drawn;
  };
  const svgs = async () => Promise.all(blobs.filter((b) => b.type.startsWith("image/svg")).map(readBlob));
  const CARDS = view().cards.length;

  it("is at the top right of the tab, once", () => {
    clipboard();
    open();
    expect(screen.getAllByRole("button", { name: "Copy all images" })).toHaveLength(1);
  });

  it("is not offered where the browser cannot put an image on the clipboard", () => {
    open();
    expect(screen.queryByRole("button", { name: "Copy all images" })).not.toBeInTheDocument();
  });

  it("puts every card on one sheet, two to a row, the home cards included, and copies it as a promise started in the click", async () => {
    const { write, items } = clipboard();
    const drawn = canvases();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy all images" }));
    // Started inside the click: nothing was awaited before the write.
    expect(write).toHaveBeenCalledTimes(1);
    expect(items[0]["image/png"]).toBeInstanceOf(Promise);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`${CARDS} images copied as one sheet`));
    const pictures = await svgs();
    expect(pictures).toHaveLength(CARDS);
    const titles = ["Net worth journey", "Debt payoff progress", "Property value & LTV", "Asset composition", "Savings rate", "Savings consistency", "Cash buffer journey", "Cash buffer"];
    titles.forEach((t) => expect(pictures.some((p) => p.includes(`>${t.replaceAll("&", "&amp;")}</text>`))).toBe(true));
    // In the order of the tab.
    const order = pictures.map((p) => titles.find((t) => p.includes(`>${t.replaceAll("&", "&amp;")}</text>`)));
    expect(order).toEqual(titles);
    // One canvas: 2 columns of 1200 and gaps; as many rows as the cards need.
    const sheet = drawn.find((d) => d.draws === CARDS)!;
    expect(sheet.canvas.width).toBe(2 * 1200 + 3 * 24);
    expect(sheet.canvas.height).toBe(Math.ceil(CARDS / 2) * 675 + (Math.ceil(CARDS / 2) + 1) * 24);
  });

  it("follows the tab's switches and the app's theme, like each card's own picture", async () => {
    mockTheme = "dark";
    clipboard();
    const drawn = canvases();
    open();
    fireEvent.click(screen.getByRole("switch", { name: "Show dates" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show text" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy all images" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const pictures = (await svgs()).map(withoutIcon).join("");
    expect(noNamespace(pictures)).not.toMatch(MONTH_NAME);
    expect(pictures).toContain("Month 1");
    expect(pictures).not.toContain("months saved");
    expect(pictures).toContain('fill="#171717"');
    expect(drawn.find((d) => d.draws === CARDS)!.fills).toContain("#404040");
  });

  it("uses the debt choice that is picked on the card", async () => {
    clipboard();
    canvases();
    open();
    fireEvent.click(within(screen.getByRole("region", { name: "Debt payoff progress" })).getByRole("button", { name: "Loans" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy all images" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect((await svgs()).some((p) => p.includes(">Loans</text>"))).toBe(true);
  });

  it("tells the person when the sheet cannot be made", async () => {
    clipboard();
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy all images" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This browser cannot draw the picture"));
  });
});
