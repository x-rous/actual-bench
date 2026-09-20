import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_MATCH_CONFIG, DEFAULT_TEXT_PRESET } from "@/lib/reconciliation/match/config";
import { DEFAULT_APPLY_CONFIG } from "@/lib/reconciliation/session/plan";
import {
  createPdfLayoutProfile,
  DEFAULT_PDF_PARSER_GUIDANCE,
  parsePdfStatementPages,
  type PdfStatementPage,
} from "@/lib/reconciliation/statement/pdf";
import type { PdfDetectionProfileCatalog } from "../lib/reconciliationApi";
import { ImportPanel } from "./ImportPanel";

const mockExtractPdfStatement = jest.fn();
const mockParsePdfStatementOffMainThread = jest.fn();

jest.mock("@/lib/reconciliation/statement/pdfClient", () => ({
  PDF_MAX_BYTES: 25 * 1024 * 1024,
  extractPdfStatement: (...args: unknown[]) => mockExtractPdfStatement(...args),
  parsePdfStatementOffMainThread: (...args: unknown[]) => mockParsePdfStatementOffMainThread(...args),
  releasePdfStatementPreviews: () => {},
}));

jest.mock("./PdfStatementReviewDialog", () => ({
  PdfStatementReviewDialog: ({ open, activeProfileId, profileNotice }: {
    open: boolean;
    activeProfileId?: string | null;
    profileNotice?: string | null;
  }) => open ? (
    <div role="dialog" aria-label="Mock PDF review">
      <span>Active profile: {activeProfileId ?? "none"}</span>
      {profileNotice && <span>{profileNotice}</span>}
    </div>
  ) : null,
}));

function parsedStatement() {
  const page: PdfStatementPage = {
    pageNumber: 1,
    width: 700,
    height: 800,
    items: [
      ["Transaction Date", 20, 740], ["Description", 120, 740], ["Amount", 480, 740],
      ["08/15/2026", 20, 700], ["ANON SHOP", 120, 700], ["USD -12.50", 480, 700],
    ].map(([text, x, y], index) => ({
      id: `item-${index}`,
      str: String(text),
      transform: [10, 0, 0, 10, Number(x), Number(y)],
      width: String(text).length * 6,
      height: 10,
    })),
  };
  return parsePdfStatementPages([page], {
    guidance: { ...DEFAULT_PDF_PARSER_GUIDANCE, currency: "USD", dateFormat: "mdy" },
  });
}

function catalogFor(result: ReturnType<typeof parsedStatement>): PdfDetectionProfileCatalog {
  const profile = createPdfLayoutProfile({ id: "layout-1", name: "Credit card", result });
  return {
    banks: [{
      id: "bank-1",
      name: "HSBC Bank",
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    }],
    profiles: [{
      id: "record-1",
      bankId: "bank-1",
      name: "Credit card",
      profile: { kind: "pdf-layout-v2", profile },
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    }],
    accountProfileId: "record-1",
  };
}

function renderPanel(catalog: PdfDetectionProfileCatalog) {
  render(
    <ImportPanel
      accountName="HSBC credit card"
      matchConfig={DEFAULT_MATCH_CONFIG}
      matchPreset={DEFAULT_TEXT_PRESET}
      applyConfig={DEFAULT_APPLY_CONFIG}
      onApplyConfigChange={() => {}}
      profiles={[]}
      pdfDetectionCatalog={catalog}
      onMatchConfigChange={() => {}}
      onApplyProfile={() => {}}
      onSaveProfile={() => {}}
      onReadyChange={() => {}}
    />
  );
}

describe("ImportPanel PDF detection profiles", () => {
  beforeEach(() => {
    mockExtractPdfStatement.mockReset();
    mockParsePdfStatementOffMainThread.mockReset();
  });

  it("applies the account's assigned profile before opening PDF review", async () => {
    const parsed = parsedStatement();
    mockExtractPdfStatement.mockResolvedValue(parsed);
    mockParsePdfStatementOffMainThread.mockImplementation(async (_document, options) => ({
      ...parsed,
      guidance: options.guidance,
    }));
    renderPanel(catalogFor(parsed));

    fireEvent.change(screen.getByLabelText("Upload a statement"), {
      target: { files: [new File(["pdf"], "statement.pdf", { type: "application/pdf" })] },
    });

    expect(await screen.findByText("Active profile: record-1")).toBeInTheDocument();
    expect(mockParsePdfStatementOffMainThread).toHaveBeenCalledWith(
      parsed.document,
      expect.objectContaining({ guidance: expect.objectContaining({ columns: expect.any(Array) }) }),
      expect.any(AbortSignal)
    );
  });

  it("applies the exact profile assigned to the account", async () => {
    const parsed = parsedStatement();
    const catalog = catalogFor(parsed);
    const checking = createPdfLayoutProfile({ id: "layout-2", name: "Checking", result: parsed });
    catalog.profiles.push({
      id: "record-2",
      bankId: "bank-1",
      name: "Checking",
      profile: { kind: "pdf-layout-v2", profile: checking },
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    });
    catalog.accountProfileId = "record-2";
    mockExtractPdfStatement.mockResolvedValue(parsed);
    mockParsePdfStatementOffMainThread.mockImplementation(async (_document, options) => ({
      ...parsed,
      guidance: options.guidance,
    }));
    renderPanel(catalog);

    fireEvent.change(screen.getByLabelText("Upload a statement"), {
      target: { files: [new File(["pdf"], "statement.pdf", { type: "application/pdf" })] },
    });

    expect(await screen.findByText("Active profile: record-2")).toBeInTheDocument();
  });

  it("does not enable PDF upload until the global profile catalog is ready", () => {
    render(
      <ImportPanel
        accountName="HSBC credit card"
        matchConfig={DEFAULT_MATCH_CONFIG}
        matchPreset={DEFAULT_TEXT_PRESET}
        applyConfig={DEFAULT_APPLY_CONFIG}
        onApplyConfigChange={() => {}}
        profiles={[]}
        isLoadingPdfDetectionProfiles
        onMatchConfigChange={() => {}}
        onApplyProfile={() => {}}
        onSaveProfile={() => {}}
        onReadyChange={() => {}}
      />
    );

    expect(screen.getByLabelText("Upload a statement")).toBeDisabled();
    expect(mockExtractPdfStatement).not.toHaveBeenCalled();
  });
});
