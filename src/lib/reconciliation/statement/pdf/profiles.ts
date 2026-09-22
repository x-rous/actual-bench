import type {
  PdfColumnRole,
  PdfLayoutSignature,
  PdfParserGuidance,
  PdfReconstructedPage,
  PdfTableSchema,
} from "./model";
import { sourceSafeShape } from "./text";

/**
 * A mapped column, as a layout keeps it.
 *
 * Bounds are fractions of the page width, so a layout describes a table
 * rather than a page: the same statement printed at another size, or read at
 * another scale, still lands on the same columns. Nothing here is taken from
 * the document - no header text, no example values, no confidence from a
 * detection run that has since been corrected.
 */
export type PdfLayoutColumn = {
  id: string;
  role: PdfColumnRole;
  /** Null when the column applies to every page, which is the usual case. */
  pageNumber: number | null;
  xStart: number;
  xEnd: number;
};

/**
 * How to read this bank's statements, and nothing about any one of them.
 *
 * Deliberately not `PdfParserGuidance`: that carries the statement period and
 * the transaction areas, which belong to a document. A period moves every
 * month, and areas are indexed by page number, which shifts the moment a
 * statement runs to a different length.
 */
export type PdfLayoutReading = {
  version: 1;
  accountType: PdfParserGuidance["accountType"];
  currency: string | null;
  dateFormat: PdfParserGuidance["dateFormat"];
  numberFormat: PdfParserGuidance["numberFormat"];
  importDate: PdfParserGuidance["importDate"];
  unsignedDirection: PdfParserGuidance["unsignedDirection"];
  printedSign: PdfParserGuidance["printedSign"];
  transactionAnchorRole: PdfParserGuidance["transactionAnchorRole"];
  columns: PdfLayoutColumn[];
};

export type PdfLayoutProfile = {
  id: string;
  name: string;
  parserVersion: 2;
  /** What this layout was captured from, for recognizing the template again. */
  signature: PdfLayoutSignature;
  reading: PdfLayoutReading;
  createdAt: string;
  updatedAt: string;
};

/**
 * A saved layout is the current answer, not a version chain. Updating one
 * replaces it; keeping the old settings means saving under another name.
 */
export type PdfLayoutProfileEnvelope = {
  kind: "pdf-layout-v3";
  profile: PdfLayoutProfile;
};

export type PdfProfileMatch = {
  outcome: "strong" | "possible" | "weak" | "conflicting";
  score: number;
  reasons: string[];
  drift: boolean;
};

/**
 * The statement's template, taken from its table header.
 *
 * Computed from the reconstructed layout before columns are mapped or cells
 * divided, which is what makes it comparable across months and across
 * corrections: the same signature comes out whether the reader has fixed the
 * mapping or not.
 */
export function createPdfLayoutSignature(pages: PdfReconstructedPage[]): PdfLayoutSignature {
  const page = pages.find((entry) => entry.rows.some((row) => row.tableHeader)) ?? pages[0];
  const headerRow = page?.rows.find((row) => row.tableHeader);
  return {
    aspect: page ? Math.round((page.width / Math.max(1, page.height)) * 100) : 0,
    rotation: page?.rotation ?? 0,
    header: (headerRow?.cells ?? [])
      .map((cell) => ({
        shape: sourceSafeShape(cell.text),
        x: Math.round((cell.x / Math.max(1, page?.width ?? 1)) * 100),
        width: Math.round((cell.width / Math.max(1, page?.width ?? 1)) * 100),
      }))
      .filter((cell) => cell.shape.length > 0),
  };
}

/**
 * How much of one statement's header is the other's.
 *
 * A cell counts as the same when it prints the same shape within three percent
 * of the page width of the same place: a bank moving a column slightly between
 * statement runs is still the same template, a different bank is not.
 */
function headerSimilarity(saved: PdfLayoutSignature | null, current: PdfLayoutSignature) {
  if (!saved?.header.length || !current.header.length) return null;
  if (Math.abs(saved.aspect - current.aspect) > 3) return 0;
  const remaining = [...current.header];
  let matched = 0;
  for (const cell of saved.header) {
    const index = remaining.findIndex((entry) => entry.shape === cell.shape && Math.abs(entry.x - cell.x) <= 3);
    if (index < 0) continue;
    remaining.splice(index, 1);
    matched += 1;
  }
  return matched / Math.max(saved.header.length, current.header.length);
}

export function matchPdfLayoutProfile(
  profile: PdfLayoutProfile,
  current: {
    reconstructedPages: PdfReconstructedPage[];
    activeSchema: PdfTableSchema | null;
    detectionSignature: PdfLayoutSignature;
  }
): PdfProfileMatch {
  /*
    The table header first, when both sides have one.

    The alternative below compares a saved layout's corrected columns against
    this statement's detected ones, which measures how much correcting was
    needed rather than whether this is the same statement - so a layout scored
    worse the more carefully it had been fixed, and the ones worth keeping were
    the ones most likely to be refused. A header is the same on both sides
    whatever anyone has corrected, so it is asked first and trusted.
  */
  const headerScore = headerSimilarity(profile.signature, current.detectionSignature);
  if (headerScore !== null) {
    if (headerScore >= 0.85) return { outcome: "strong", score: headerScore, reasons: ["statement header matches the saved layout"], drift: false };
    if (headerScore >= 0.6) return { outcome: "possible", score: headerScore, reasons: ["most of the statement header matches the saved layout"], drift: true };
    if (headerScore >= 0.25) return { outcome: "weak", score: headerScore, reasons: ["only part of the statement header matches the saved layout"], drift: true };
    return { outcome: "conflicting", score: headerScore, reasons: ["this statement's table header is not the one the layout was saved from"], drift: true };
  }

  // No header to compare on either side, so fall back to the table's shape.
  const expectedRoles = new Set(profile.reading.columns.map((column) => column.role));
  const actualRoles = new Set((current.activeSchema?.columns ?? []).map((column) => column.role));
  const overlap = [...expectedRoles].filter((role) => actualRoles.has(role)).length / Math.max(1, expectedRoles.size);
  const geometryDistance = columnGeometryDistance(profile, current.reconstructedPages, current.activeSchema);
  const geometryScore = Math.max(0, 1 - geometryDistance * 4);
  const score = overlap * 0.7 + geometryScore * 0.3;
  const drift = overlap < 0.8 || geometryDistance > 0.06;
  if (!drift && overlap >= 0.9) {
    return { outcome: "strong", score, reasons: ["roles and column geometry match"], drift: false };
  }
  if (overlap >= 0.9 && geometryDistance <= 0.12) {
    return {
      outcome: "possible",
      score,
      reasons: [drift ? "roles match but column geometry drifted" : "roles and column geometry match"],
      drift,
    };
  }
  if (overlap >= 0.55 && geometryDistance <= 0.25) return { outcome: "weak", score, reasons: ["only part of the saved layout still aligns"], drift: true };
  return { outcome: "conflicting", score, reasons: ["mapped roles or column geometry conflict with this statement"], drift: true };
}

/** Both sides as fractions of their own page, so page size cannot matter. */
function columnGeometryDistance(
  profile: PdfLayoutProfile,
  pages: PdfReconstructedPage[],
  schema: PdfTableSchema | null
) {
  const currentWidth = pages[0]?.width ?? 1;
  const distances = profile.reading.columns.flatMap((saved) => {
    const current = schema?.columns.find((column) => column.role === saved.role);
    if (!current) return [];
    const width = current.referencePageWidth ?? currentWidth;
    const start = Math.abs(saved.xStart - current.xStart / width);
    const end = Math.abs(saved.xEnd - current.xEnd / width);
    return [(start + end) / 2];
  });
  // A single moved financial column is material even when every other column
  // still aligns, so use the worst mapped-column drift rather than averaging
  // it away across the table.
  return distances.length ? Math.max(...distances) : 1;
}

/**
 * The part of a set of parser instructions that a layout keeps.
 *
 * Guidance also carries the statement period and the transaction areas, which
 * belong to the document in front of the reader. Reducing to this before
 * comparing is what separates "you have changed how this bank is read" from
 * "you have changed something about this month's statement".
 */
export function layoutReadingFromGuidance(guidance: PdfParserGuidance, pageWidth: number): PdfLayoutReading {
  return {
    version: 1,
    accountType: guidance.accountType,
    currency: guidance.currency,
    dateFormat: guidance.dateFormat,
    numberFormat: guidance.numberFormat,
    importDate: guidance.importDate,
    unsignedDirection: guidance.unsignedDirection,
    printedSign: guidance.printedSign,
    transactionAnchorRole: guidance.transactionAnchorRole,
    columns: guidance.columns.map((column) => ({
      id: column.id,
      role: column.role,
      pageNumber: column.pageNumber,
      xStart: column.xStart / Math.max(1, column.referencePageWidth ?? pageWidth),
      xEnd: column.xEnd / Math.max(1, column.referencePageWidth ?? pageWidth),
    })),
  };
}

/**
 * Two readings that would save as the same layout give the same key.
 *
 * Column ids are left out: a re-detected column can arrive with a new id
 * without anything about the reading having changed, and asking the reader to
 * save that is asking them to save nothing. Bounds are rounded to four places,
 * which on a page of six hundred points is a twentieth of a point - below
 * anything a boundary drag can mean.
 */
export function layoutReadingKey(reading: PdfLayoutReading): string {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return JSON.stringify({
    accountType: reading.accountType,
    currency: reading.currency,
    dateFormat: reading.dateFormat,
    numberFormat: reading.numberFormat,
    importDate: reading.importDate,
    unsignedDirection: reading.unsignedDirection,
    printedSign: reading.printedSign ?? "auto",
    transactionAnchorRole: reading.transactionAnchorRole,
    columns: [...reading.columns]
      .sort((left, right) => left.xStart - right.xStart)
      .map((column) => [column.role, column.pageNumber, round(column.xStart), round(column.xEnd)]),
  });
}

export function createPdfLayoutProfile(input: {
  id: string;
  name: string;
  result: {
    reconstructedPages: PdfReconstructedPage[];
    guidance: PdfParserGuidance;
    detectionSignature: PdfLayoutSignature;
  };
  createdAt?: string;
}): PdfLayoutProfile {
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name,
    parserVersion: 2,
    signature: input.result.detectionSignature,
    reading: layoutReadingFromGuidance(
      input.result.guidance,
      input.result.reconstructedPages[0]?.width ?? 1
    ),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * The layout, read onto the statement in front of us.
 *
 * Transaction areas come from this statement every time. A saved area was
 * indexed by page number, which is the one thing guaranteed to move between
 * statements of different lengths, and all it ever contributed was whether a
 * detected area was included - a decision the detector makes again here, on
 * the right number of pages.
 */
export function guidanceFromPdfLayoutProfile(
  profile: PdfLayoutProfile,
  current: {
    reconstructedPages: PdfReconstructedPage[];
    detectedGuidance: PdfParserGuidance;
    guidance?: PdfParserGuidance;
  }
): PdfParserGuidance {
  const pageWidth = current.reconstructedPages[0]?.width ?? 1;
  return {
    ...current.detectedGuidance,
    accountType: profile.reading.accountType,
    currency: profile.reading.currency,
    dateFormat: profile.reading.dateFormat,
    numberFormat: profile.reading.numberFormat,
    importDate: profile.reading.importDate,
    unsignedDirection: profile.reading.unsignedDirection,
    printedSign: profile.reading.printedSign,
    transactionAnchorRole: profile.reading.transactionAnchorRole,
    statementPeriod: current.guidance?.statementPeriod ?? current.detectedGuidance.statementPeriod,
    regions: current.detectedGuidance.regions,
    columns: profile.reading.columns.map((column) => ({
      id: column.id,
      role: column.role,
      pageNumber: column.pageNumber,
      referencePageWidth: pageWidth,
      xStart: column.xStart * pageWidth,
      xEnd: column.xEnd * pageWidth,
      header: null,
      examples: [],
      confidence: 1,
    })),
  };
}

export function isPdfLayoutProfileEnvelope(value: unknown): value is PdfLayoutProfileEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<PdfLayoutProfileEnvelope>;
  const profile = envelope.profile as Partial<PdfLayoutProfile> | undefined;
  return envelope.kind === "pdf-layout-v3"
    && profile?.parserVersion === 2
    && typeof profile.id === "string"
    && typeof profile.name === "string"
    && Boolean(profile.reading)
    && Boolean(profile.signature);
}

/**
 * Rebuild a persisted layout from an allow-list of declarative fields.
 *
 * This is the server persistence boundary: even a hand-crafted API request
 * cannot smuggle extracted statement text or PDF bytes into the stored JSON.
 * Everything kept is either a setting the reader chose, a fraction of a page,
 * or a masked shape - the signature's header shapes have had their letters and
 * digits replaced before they ever reach here, and are checked again below.
 */
export function sanitizePdfLayoutProfileEnvelope(value: unknown): PdfLayoutProfileEnvelope | null {
  if (!isPdfLayoutProfileEnvelope(value)) return null;
  const current = sanitizeProfile(value.profile);
  if (!current) return null;
  return { kind: "pdf-layout-v3", profile: current };
}

const ACCOUNT_TYPES = new Set(["auto", "credit-card", "checking", "savings", "prepaid", "multi-currency", "business-cash", "loan", "investment", "unknown"]);
const DATE_FORMATS = new Set(["auto", "iso", "dmy", "mdy", "dmy-name", "ymd-compact", "ymd"]);
const NUMBER_FORMATS = new Set(["auto", "us", "european", "space", "indian", "swiss"]);
const IMPORT_DATES = new Set(["transaction", "posting", "value"]);
const UNSIGNED_DIRECTIONS = new Set(["review", "debit", "credit"]);
const PRINTED_SIGNS = new Set(["auto", "account-holder", "issuer"]);
const ANCHOR_ROLES = new Set(["transaction-date", "posting-date", "value-date"]);
const COLUMN_ROLES = new Set(["transaction-date", "posting-date", "value-date", "description", "reference", "debit", "credit", "amount", "direction", "balance", "original-amount", "original-currency", "exchange-rate", "currency", "fee", "vat", "ignore"]);
/** Letters and digits masked to A and 9, with spaces and punctuation left. */
const MASKED_SHAPE = /^[^A-Za-z0-8]*(?:[A9][^A-Za-z0-8]*)*$/;

function sanitizeProfile(profile: PdfLayoutProfile): PdfLayoutProfile | null {
  const reading = profile.reading;
  const signature = profile.signature;
  if (!reading || reading.version !== 1) return null;
  if (!profile.id || !profile.name || typeof profile.createdAt !== "string") return null;
  if (profile.updatedAt !== undefined && typeof profile.updatedAt !== "string") return null;
  if (!ACCOUNT_TYPES.has(reading.accountType)) return null;
  if (!DATE_FORMATS.has(reading.dateFormat)) return null;
  if (!NUMBER_FORMATS.has(reading.numberFormat)) return null;
  if (!IMPORT_DATES.has(reading.importDate)) return null;
  if (!UNSIGNED_DIRECTIONS.has(reading.unsignedDirection)) return null;
  if (!PRINTED_SIGNS.has(reading.printedSign ?? "auto")) return null;
  if (!ANCHOR_ROLES.has(reading.transactionAnchorRole)) return null;
  if (reading.currency !== null && !/^[A-Z]{3}$/.test(reading.currency)) return null;
  if (!Array.isArray(reading.columns) || !reading.columns.length) return null;
  if (!reading.columns.every((column) =>
    typeof column.id === "string"
    && COLUMN_ROLES.has(column.role)
    && (column.pageNumber === null || Number.isInteger(column.pageNumber))
    && Number.isFinite(column.xStart)
    && Number.isFinite(column.xEnd)
    // Fractions of a page, so anything outside it is not a column.
    && column.xStart >= 0
    && column.xEnd <= 1
    && column.xEnd > column.xStart
  )) return null;

  if (!signature
    || !Number.isFinite(signature.aspect)
    || !Number.isFinite(signature.rotation)
    || !Array.isArray(signature.header)) return null;
  if (!signature.header.every((cell) =>
    typeof cell.shape === "string"
    && cell.shape.length <= 64
    // A shape that still holds letters or digits is statement text, not a
    // shape, whatever it claims to be.
    && MASKED_SHAPE.test(cell.shape)
    && Number.isFinite(cell.x)
    && Number.isFinite(cell.width)
  )) return null;

  return {
    id: profile.id,
    name: profile.name,
    parserVersion: 2,
    signature: {
      aspect: signature.aspect,
      rotation: signature.rotation,
      header: signature.header.map((cell) => ({ shape: cell.shape, x: cell.x, width: cell.width })),
    },
    reading: {
      version: 1,
      accountType: reading.accountType,
      currency: reading.currency,
      dateFormat: reading.dateFormat,
      numberFormat: reading.numberFormat,
      importDate: reading.importDate,
      unsignedDirection: reading.unsignedDirection,
      printedSign: reading.printedSign ?? "auto",
      transactionAnchorRole: reading.transactionAnchorRole,
      columns: reading.columns.map((column) => ({
        id: column.id,
        role: column.role,
        pageNumber: column.pageNumber,
        xStart: column.xStart,
        xEnd: column.xEnd,
      })),
    },
    createdAt: profile.createdAt,
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : profile.createdAt,
  };
}
