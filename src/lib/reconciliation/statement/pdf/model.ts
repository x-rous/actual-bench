import type { StatementDateFormat } from "../normalize";

export const PDF_PARSER_MODEL_VERSION = 2 as const;

export type PdfSourceBox = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextItem = {
  id?: string;
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  dir?: "ltr" | "rtl" | "ttb";
  fontName?: string;
  hasEOL?: boolean;
};

export type PdfStatementPage = {
  pageNumber: number;
  width?: number;
  height?: number;
  rotation?: number;
  /** PDF.js viewport transform; maps PDF coordinates to top-left viewport coordinates. */
  viewportTransform?: number[];
  /** Memory-only rendered source page for visual review; never persisted in a profile. */
  previewDataUrl?: string;
  items: PdfTextItem[];
};

export type PdfStatementDocument = {
  version?: 1 | 2;
  pages: PdfStatementPage[];
};

export type PdfPositionedToken = PdfSourceBox & {
  id: string;
  rawText: string;
  text: string;
  direction: "ltr" | "rtl";
  fontHeight: number;
};

export type PdfVisualCell = PdfSourceBox & {
  id: string;
  rawText: string;
  text: string;
  tokenIds: string[];
  /**
   * Set when more than one mapped column covered this cell and it was settled
   * in favour of one of them. Only that column reads the value.
   */
  columnId?: string;
};

export type PdfVisualRow = PdfSourceBox & {
  id: string;
  rawText: string;
  text: string;
  cellIds: string[];
  cells: PdfVisualCell[];
  repeatedHeaderFooter: boolean;
  /**
   * The statement's own column header. It stays in its area so column
   * detection can read the printed names, and never joins a transaction.
   */
  tableHeader?: boolean;
};

export type PdfReconstructedPage = {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  coverage: number;
  imageOnlyLikelihood: number;
  tokens: PdfPositionedToken[];
  rows: PdfVisualRow[];
};

export type PdfRegionKind =
  | "transactions"
  | "summary"
  | "rewards"
  | "installments"
  | "fees"
  | "other";

export type PdfRegion = PdfSourceBox & {
  id: string;
  kind: PdfRegionKind;
  included: boolean;
  confidence: number;
  rowIds: string[];
  reasons: string[];
};

export type PdfColumnRole =
  | "transaction-date"
  | "posting-date"
  | "value-date"
  | "description"
  | "reference"
  | "debit"
  | "credit"
  | "amount"
  | "direction"
  | "balance"
  | "original-amount"
  | "original-currency"
  | "exchange-rate"
  | "currency"
  | "fee"
  | "vat"
  | "ignore";

export type PdfColumn = {
  id: string;
  pageNumber: number | null;
  /** Width whose coordinate system xStart/xEnd use. Omitted for legacy absolute mappings. */
  referencePageWidth?: number;
  xStart: number;
  xEnd: number;
  role: PdfColumnRole;
  header: string | null;
  examples: string[];
  confidence: number;
};

export type PdfTableSchema = {
  id: string;
  regionIds: string[];
  columns: PdfColumn[];
  score: number;
  reasons: string[];
};

export type PdfAccountType =
  | "credit-card"
  | "checking"
  | "savings"
  | "prepaid"
  | "multi-currency"
  | "business-cash"
  | "loan"
  | "investment"
  | "unknown";

export type PdfBalanceBehavior =
  | "none"
  | "running"
  | "available"
  | "periodic"
  | "unknown";

/**
 * How a balance column moves for this statement. `deposit` means a credit
 * raises the balance; `liability` means a credit lowers what is owed. The
 * source records how far the parser may trust it: printed directions that
 * already agree with the balance column are evidence, a user-chosen or
 * profile-chosen account type is confirmed, and a keyword-detected account
 * type is a guess that keeps derived directions in review.
 */
export type PdfBalancePolarity = {
  direction: "deposit" | "liability";
  source: "evidence" | "confirmed-type" | "detected-type";
};

export type PdfBalanceCheckpoint = {
  kind: "opening" | "carry-forward" | "closing";
  pageNumber: number;
  y: number;
  coefficient: string;
  scale: number;
  sourceIds: string[];
};

export type PdfDateFormatOption = "auto" | StatementDateFormat | "ymd";
export type PdfNumberFormat = "auto" | "us" | "european" | "space" | "indian" | "swiss";
export type PdfImportDate = "transaction" | "posting" | "value";
export type PdfUnsignedDirection = "review" | "debit" | "credit";
/**
 * Whose perspective the printed sign uses. Deposit accounts print from the
 * account holder's side, where a minus is money out. Card and loan issuers
 * print from their own side, where a minus reduces what is owed and is money
 * in for the Actual account.
 */
export type PdfPrintedSign = "auto" | "account-holder" | "issuer";
export type PdfCorrectionScope = "row" | "similar-rows" | "file" | "profile";

export type PdfParserGuidance = {
  version: 1;
  accountType: PdfAccountType | "auto";
  currency: string | null;
  statementPeriod: { start: string | null; end: string | null };
  dateFormat: PdfDateFormatOption;
  numberFormat: PdfNumberFormat;
  importDate: PdfImportDate;
  unsignedDirection: PdfUnsignedDirection;
  printedSign: PdfPrintedSign;
  regions: PdfRegion[];
  columns: PdfColumn[];
  transactionAnchorRole: "transaction-date" | "posting-date" | "value-date";
};

export const DEFAULT_PDF_PARSER_GUIDANCE: PdfParserGuidance = {
  version: 1,
  accountType: "auto",
  currency: null,
  statementPeriod: { start: null, end: null },
  dateFormat: "auto",
  numberFormat: "auto",
  importDate: "transaction",
  unsignedDirection: "review",
  printedSign: "auto",
  regions: [],
  columns: [],
  transactionAnchorRole: "transaction-date",
};

export type PdfConfidenceStatus = "accepted" | "review" | "rejected";

export type PdfConfidenceReason =
  | "DATE_AMBIGUOUS_ORDER"
  | "DATE_YEAR_INFERRED_FROM_PERIOD"
  | "DATE_INHERITED_FROM_PREVIOUS_ROW"
  | "DATE_OUTSIDE_STATEMENT_PERIOD"
  | "DATE_INVALID"
  | "AMOUNT_MULTIPLE_CANDIDATES"
  | "AMOUNT_DEBIT_CREDIT_CONFLICT"
  | "AMOUNT_FROM_MAPPED_COLUMN"
  | "AMOUNT_FORMAT_AMBIGUOUS"
  | "AMOUNT_MISSING"
  | "AMOUNT_ZERO"
  | "CURRENCY_AMBIGUOUS"
  | "CURRENCY_MINOR_UNIT_MISMATCH"
  | "ACTUAL_PRECISION_UNSUPPORTED"
  | "DIRECTION_FROM_DEBIT_COLUMN"
  | "DIRECTION_FROM_CREDIT_COLUMN"
  | "DIRECTION_FROM_MARKER"
  | "DIRECTION_FROM_SIGN"
  | "SIGN_CONVENTION_UNCONFIRMED"
  | "DIRECTION_FROM_BALANCE"
  | "ACCOUNT_TYPE_UNCONFIRMED"
  | "DIRECTION_FROM_SECTION"
  | "DIRECTION_EXPLICIT_POLICY"
  | "DIRECTION_FROM_MARKER_CONVENTION"
  | "DIRECTION_UNRESOLVED"
  | "DIRECTION_EVIDENCE_CONFLICT"
  | "BALANCE_RECONCILED"
  | "BALANCE_MISMATCH"
  | "ROW_CONTINUATION_UNCERTAIN"
  | "ROW_IN_NON_TRANSACTION_SECTION"
  | "ROW_MANUALLY_CHANGED"
  | "PROFILE_LAYOUT_DRIFT"
  | "PAGE_IMAGE_ONLY"
  | "POSSIBLE_DUPLICATE"
  | "STATEMENT_SUMMARY_MISMATCH"
  | "CROSS_PAGE_SEQUENCE_CHANGED"
  | "ACCOUNT_TYPE_SPECIALIZED"
  | "DESCRIPTION_MISSING";

export type PdfFieldConfidence = {
  status: PdfConfidenceStatus;
  score: number;
  reasons: PdfConfidenceReason[];
  sourceIds: string[];
  alternatives?: { value: string; label: string; score: number }[];
};

export type PdfExactMoney = {
  coefficient: string;
  scale: number;
  currency: string | null;
  raw: string;
  sourceIds: string[];
};

export type PdfDirection = "debit" | "credit" | "unknown";
export type PdfDirectionEvidence =
  | "debit-column"
  | "credit-column"
  | "marker"
  | "signed"
  | "balance"
  | "section"
  | "explicit-policy"
  | "marker-convention"
  | "manual"
  | "unknown";

export type PdfTransactionBlock = PdfSourceBox & {
  id: string;
  sectionId: string;
  rowIds: string[];
  sourceIds: string[];
  excluded: boolean;
  manuallyCreated: boolean;
  /** The statement suppressed its repeated date on this otherwise complete row. */
  inheritsPreviousDate?: boolean;
  /** Direction declared by a transaction-section heading, when present. */
  sectionDirection?: "debit" | "credit";
};

export type PdfTransactionProposal = {
  id: string;
  sourceRowNumber: number;
  sectionId: string;
  transactionDate: string | null;
  postedDate: string | null;
  valueDate: string | null;
  importDate: string | null;
  description: string;
  reference: string | null;
  amount: string;
  exactAmount: PdfExactMoney | null;
  originalAmount: PdfExactMoney | null;
  exchangeRate: string | null;
  fees: PdfExactMoney[];
  vat: PdfExactMoney[];
  direction: PdfDirection;
  directionEvidence: PdfDirectionEvidence;
  balance: string | null;
  currency: string | null;
  confidence: {
    rowBoundary: PdfFieldConfidence;
    transactionDate: PdfFieldConfidence;
    postingDate: PdfFieldConfidence | null;
    valueDate: PdfFieldConfidence | null;
    importDate: PdfFieldConfidence;
    description: PdfFieldConfidence;
    reference: PdfFieldConfidence | null;
    accountAmount: PdfFieldConfidence;
    originalAmount: PdfFieldConfidence | null;
    exchangeRate: PdfFieldConfidence | null;
    fees: PdfFieldConfidence[];
    vat: PdfFieldConfidence[];
    direction: PdfFieldConfidence;
    currency: PdfFieldConfidence;
    balance: PdfFieldConfidence | null;
  };
  status: PdfConfidenceStatus;
  issueCodes: PdfConfidenceReason[];
  raw: { pageNumber: number; lines: string[]; sourceIds: string[] };
};

export type PdfDiagnosticEvent = {
  stage: "extract" | "normalize" | "layout" | "region" | "schema" | "block" | "interpret" | "validate" | "profile";
  code: string;
  pageNumber?: number;
  sourceIds?: string[];
  metrics?: Record<string, number | string | boolean | null>;
};

export type PdfParseMetrics = {
  pages: number;
  transactionPages: number;
  transactions: number;
  accepted: number;
  review: number;
  rejected: number;
  duplicates: number;
  skippedRegions: number;
  /** Rows inside an included transaction area that no block claimed. */
  unassignedRows: number;
  /** Pages whose text layer is unusable while other pages parsed normally. */
  imageOnlyPages: number;
  /** Pages the extraction stage could not read at all. Set by the PDF.js bridge. */
  unreadablePages: number;
};

export type PdfStatementParseResult = {
  modelVersion: typeof PDF_PARSER_MODEL_VERSION;
  document: PdfStatementDocument;
  reconstructedPages: PdfReconstructedPage[];
  regions: PdfRegion[];
  schemaHypotheses: PdfTableSchema[];
  activeSchema: PdfTableSchema | null;
  blocks: PdfTransactionBlock[];
  guidance: PdfParserGuidance;
  detectedGuidance: PdfParserGuidance;
  accountType: PdfAccountType;
  balanceBehavior: PdfBalanceBehavior;
  /** How the balance column was read, and how far that reading can be trusted. */
  balancePolarity: PdfBalancePolarity | null;
  transactions: PdfTransactionProposal[];
  diagnostics: PdfDiagnosticEvent[];
  metrics: PdfParseMetrics;
  likelyScanned: boolean;
  warnings: string[];
};
