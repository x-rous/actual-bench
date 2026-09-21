import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_PDF_PARSER_GUIDANCE,
  parsePdfStatementPages,
  type PdfReconstructedPage,
  type PdfRegion,
} from "@/lib/reconciliation/statement/pdf";
import { PdfSourcePreview } from "./PdfSourcePreview";

function parsedPage() {
  return parsePdfStatementPages([{
    pageNumber: 1,
    width: 700,
    height: 800,
    items: [
      { id: "date-header", str: "Date", transform: [10, 0, 0, 10, 20, 740], width: 30, height: 10 },
      { id: "description-header", str: "Description", transform: [10, 0, 0, 10, 120, 740], width: 66, height: 10 },
      { id: "amount-header", str: "Amount", transform: [10, 0, 0, 10, 480, 740], width: 40, height: 10 },
      { id: "date", str: "08/15/2026", transform: [10, 0, 0, 10, 20, 700], width: 66, height: 10 },
      { id: "description", str: "ANON SHOP", transform: [10, 0, 0, 10, 120, 700], width: 60, height: 10 },
      { id: "amount", str: "USD -12.50", transform: [10, 0, 0, 10, 480, 700], width: 66, height: 10 },
    ],
  }], {
    guidance: { ...DEFAULT_PDF_PARSER_GUIDANCE, currency: "USD", dateFormat: "mdy" },
  });
}

function PreviewHarness({
  page,
  highlightedSourceIds = new Set<string>(),
  focusColumnRequest = null,
  calibration = false,
  regions = [],
  showColumnToggle = false,
}: {
  page: PdfReconstructedPage;
  highlightedSourceIds?: Set<string>;
  focusColumnRequest?: { columnId: string; requestId: number } | null;
  calibration?: boolean;
  regions?: PdfRegion[];
  showColumnToggle?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [columnMappingsVisible, setColumnMappingsVisible] = useState(true);
  const parsed = parsedPage();
  return (
    <div className="h-[40rem] w-[50rem]">
      <PdfSourcePreview
        page={page}
        regions={regions}
        columns={columnMappingsVisible ? parsed.guidance.columns : []}
        highlightedSourceIds={highlightedSourceIds}
        selectedRowId={null}
        calibration={calibration}
        zoom={zoom}
        onZoomChange={setZoom}
        columnMappingsVisible={columnMappingsVisible}
        onToggleColumnMappings={showColumnToggle ? () => setColumnMappingsVisible((current) => !current) : undefined}
        focusColumnRequest={focusColumnRequest}
        onSelectRow={() => {}}
        onToggleRegion={() => {}}
        onColumnChange={() => {}}
      />
    </div>
  );
}

function installViewerGeometry(viewer: HTMLElement, pageElement: HTMLElement) {
  Object.defineProperties(viewer, {
    clientWidth: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 240 },
    scrollLeft: { configurable: true, value: 0, writable: true },
    scrollTop: { configurable: true, value: 0, writable: true },
  });
  Object.defineProperties(pageElement, {
    offsetLeft: { configurable: true, value: 12 },
    offsetTop: { configurable: true, value: 12 },
    offsetWidth: { configurable: true, value: 700 },
    offsetHeight: { configurable: true, value: 800 },
  });
  const scrollTo = jest.fn((options: ScrollToOptions) => {
    viewer.scrollLeft = Number(options.left ?? viewer.scrollLeft);
    viewer.scrollTop = Number(options.top ?? viewer.scrollTop);
  });
  Object.defineProperty(viewer, "scrollTo", { configurable: true, value: scrollTo });
  return scrollTo;
}

describe("PdfSourcePreview", () => {
  it("fills the viewer width and provides bounded zoom controls over the page", () => {
    const parsed = parsedPage();
    render(<PreviewHarness page={parsed.reconstructedPages[0]} />);

    const pageElement = document.querySelector<HTMLElement>("[data-pdf-page-number='1']")!;
    expect(pageElement).toHaveStyle({ width: "100%" });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in PDF" }));
    expect(pageElement).toHaveStyle({ width: "120%" });
    expect(screen.getByRole("button", { name: "Zoom in PDF" })).toHaveAttribute("title", "Zoom in PDF (120%, or press +)");
    // The controls stay on the page, stacked down its left margin.
    const controls = screen.getByRole("group", { name: "PDF viewer controls" });
    expect(controls).toContainElement(screen.getByRole("button", { name: "Zoom in PDF" }));
    expect(controls).toHaveClass("absolute", "left-2", "top-2", "flex-col");

    fireEvent.click(screen.getByRole("button", { name: "Fit PDF to width" }));
    expect(pageElement).toHaveStyle({ width: "100%" });
    expect(screen.getByRole("button", { name: "Fit PDF to width" })).toBeDisabled();

    for (let index = 0; index < 3; index += 1) fireEvent.click(screen.getByRole("button", { name: "Zoom in PDF" }));
    expect(pageElement).toHaveStyle({ width: "160%" });
    expect(screen.getByRole("button", { name: "Zoom in PDF" })).toBeDisabled();
  });

  it("centres highlighted source evidence and requested mapped columns inside the viewer", async () => {
    const parsed = parsedPage();
    const amountSourceId = parsed.reconstructedPages[0].tokens.find((token) => token.text.includes("-12.50"))!.id;
    const page = {
      ...parsed.reconstructedPages[0],
      tokens: parsed.reconstructedPages[0].tokens.map((token) => token.id === amountSourceId ? { ...token, y: 600 } : token),
    };
    const amountToken = page.tokens.find((token) => token.text.includes("-12.50"))!;
    const amountColumn = parsed.guidance.columns.find((column) => column.role === "amount")!;
    const rendered = render(<PreviewHarness page={page} />);
    const viewer = screen.getByLabelText("PDF page 1 viewer");
    const pageElement = document.querySelector<HTMLElement>("[data-pdf-page-number='1']")!;
    const scrollTo = installViewerGeometry(viewer, pageElement);

    rendered.rerender(<PreviewHarness page={page} highlightedSourceIds={new Set([amountToken.id])} />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(viewer.scrollLeft).toBeGreaterThan(0);
    expect(viewer.scrollTop).toBeGreaterThan(0);

    scrollTo.mockClear();
    rendered.rerender(<PreviewHarness page={page} focusColumnRequest={{ columnId: amountColumn.id, requestId: 1 }} />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(viewer.scrollLeft).toBeGreaterThan(0);
  });

  it("keeps review overlays subdued and exposes the detection column toggle inside the viewer", () => {
    const parsed = parsedPage();
    const page = parsed.reconstructedPages[0];
    const amountToken = page.tokens.find((token) => token.text.includes("-12.50"))!;
    const region: PdfRegion = {
      id: "region-1",
      pageNumber: 1,
      x: 10,
      y: 10,
      width: 650,
      height: 700,
      kind: "transactions",
      included: true,
      confidence: 1,
      rowIds: page.rows.map((row) => row.id),
      reasons: [],
    };
    const rendered = render(<PreviewHarness page={page} regions={[region]} highlightedSourceIds={new Set([amountToken.id])} />);

    expect(document.querySelector('[data-pdf-region-overlay="review"]')).toHaveClass("border", "border-emerald-500/45");
    expect(document.querySelector('[data-pdf-region-overlay="review"]')).not.toHaveClass("border-2", "bg-emerald-300/5");
    expect(document.querySelector('[data-pdf-source-highlight="true"]')).toHaveClass("bg-sky-300/45");
    expect(document.querySelector('[data-pdf-source-highlight="true"]')).not.toHaveClass("ring-1", "ring-sky-700");

    rendered.rerender(<PreviewHarness page={page} regions={[region]} calibration showColumnToggle />);
    // A toggle rather than a labelled button: it shows that it is held down.
    const toggle = screen.getByRole("button", { name: "Hide column mappings" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveClass("bg-primary");
    expect(toggle).toHaveTextContent("");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show column mappings" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Show column mappings" })).not.toHaveClass("bg-primary");
    expect(screen.queryByRole("button", { name: /Move transaction-date column start boundary/ })).not.toBeInTheDocument();
  });
});
