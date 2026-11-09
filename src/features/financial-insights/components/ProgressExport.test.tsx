import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { progressView, type ProgressView } from "@/lib/financial-insights/progress";
import { AMOUNTS_MINOR, AMOUNTS_TEXT, NAMES, home, inputOf, ltvTen, richFacts } from "@/lib/financial-insights/testing/progressFixture";
import { serializeSvg } from "../lib/progressImage";
import { ProgressArt } from "./ProgressArt";
import { ProgressTabHarness as ProgressTab } from "./testing/ProgressTabHarness";

const toast = { success: jest.fn(), error: jest.fn() };
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

beforeEach(() => { sessionStorage.clear(); jest.clearAllMocks(); mockBrowser(); });
afterEach(() => { jest.restoreAllMocks(); });

async function download(card: string) {
  render(<ProgressTab view={view()} />);
  fireEvent.click(screen.getByRole("button", { name: `Share ${card}` }));
  const dialog = await screen.findByRole("dialog");
  return dialog;
}
const svgText = async () => readBlob(blobs.find((b) => b.type.startsWith("image/svg"))!);

describe("exporting a card", () => {
  it("draws a 1200 × 675 picture with the footer, and saves it as financial-insights-progress-<card>.png", async () => {
    const dialog = await download("Net worth journey");
    fireEvent.click(within(dialog).getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Image downloaded"));
    expect(downloads).toEqual(["financial-insights-progress-net-worth.png"]);
    const svg = await svgText();
    // A picture that is well-formed: the namespace is declared once, so the browser can load it.
    expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="675"');
    expect(svg).toContain("Made with Actual Bench");
    expect(svg).toContain("Net worth journey");
  });

  it("carries no amount, no name, no currency, no title element, no data attribute and no accessible text", async () => {
    const dialog = await download("Net worth journey");
    fireEvent.click(within(dialog).getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    const svg = await svgText();
    for (const minor of AMOUNTS_MINOR) expect(svg).not.toContain(String(minor));
    for (const amount of AMOUNTS_TEXT) expect(svg).not.toContain(amount);
    for (const name of NAMES) expect(svg).not.toContain(name);
    expect(svg).not.toMatch(/[$€£¥]|\b(USD|EUR|GBP)\b/);
    expect(svg).not.toMatch(/<title|<desc|data-|aria-|role=|<metadata/);
  });

  it("leaves the footer out when the footer switch is off, and the months out when dates are off", async () => {
    render(<ProgressTab view={view()} />);
    // Dates are one switch for the tab, outside the popover; the footer is in it.
    fireEvent.click(screen.getByRole("switch", { name: "Show dates" }));
    fireEvent.click(screen.getByRole("button", { name: "Share Savings rate" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: "Footer: Made with Actual Bench" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    const svg = await svgText();
    expect(svg).not.toContain("Made with Actual Bench");
    expect(noNamespace(svg)).not.toMatch(MONTH_NAME);
    expect(svg).toContain("Month 1");
  });

  it("follows the chosen theme", async () => {
    const dialog = await download("Cash buffer");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dark" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
    expect(await svgText()).toContain('fill="#171717"');
  });

  it("exports the debt choice that is picked, every card in both themes and with dates on and off, none with an amount or a name", () => {
    const v = view();
    for (const card of v.cards) {
      const choices = card.kind === "debt" ? card.choices : [null];
      for (const choice of choices) for (const theme of ["light", "dark"] as const) for (const showDates of [true, false]) {
        let node: SVGSVGElement | null = null;
        const { unmount } = render(<ProgressArt card={card} choice={choice} options={{ showDates, footer: true, theme }} svgRef={(n) => { node = n; }} />);
        const text = serializeSvg(node!);
        for (const minor of AMOUNTS_MINOR) expect(text).not.toContain(String(minor));
        for (const name of NAMES) expect(text).not.toContain(name);
        expect(text).not.toMatch(/[$€£¥]|<title|data-/);
        if (!showDates) expect(noNamespace(text)).not.toMatch(MONTH_NAME);
        expect(text).toContain(card.title);
        unmount();
      }
    }
  });

  it("tells the person when the picture cannot be made", async () => {
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const dialog = await download("Milestones");
    fireEvent.click(within(dialog).getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This browser cannot draw the picture"));
    expect(downloads).toEqual([]);
  });
});

describe("copying a card", () => {
  it("is not offered where the browser cannot put an image on the clipboard", async () => {
    const dialog = await download("Savings rate");
    expect(within(dialog).queryByRole("button", { name: "Copy image" })).not.toBeInTheDocument();
  });

  it("hands the clipboard the picture as a promise, inside the click, so Safari accepts the write", async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const items: Record<string, unknown>[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    (global as unknown as { ClipboardItem: unknown }).ClipboardItem = class { constructor(public data: Record<string, unknown>) { items.push(data); } };
    const dialog = await download("Savings rate");
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy image" }));
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
    const dialog = await download("Savings rate");
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy image" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not allowed"));
    delete (global as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
});
