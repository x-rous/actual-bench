import { fnv1aHex } from "@/lib/sync/hash";
import type { PdfParserGuidance, PdfReconstructedPage, PdfTableSchema } from "./model";
import { sourceSafeShape } from "./text";

export type PdfLayoutProfile = {
  id: string;
  name: string;
  parserVersion: 2;
  profileVersion: number;
  fingerprint: string;
  guidance: PdfParserGuidance;
  createdAt: string;
  supersedesProfileId: string | null;
  sourcePage: { width: number; height: number };
};

export type PdfLayoutProfileEnvelope = {
  kind: "pdf-layout-v2";
  profile: PdfLayoutProfile;
  history?: PdfLayoutProfile[];
};

export type PdfProfileMatch = {
  outcome: "strong" | "possible" | "weak" | "conflicting";
  score: number;
  reasons: string[];
  drift: boolean;
};

export function createPdfLayoutFingerprint(
  pages: PdfReconstructedPage[],
  schema: PdfTableSchema | null
) {
  const pageShapes = pages.map((page) => ({
    aspect: Math.round((page.width / Math.max(1, page.height)) * 20),
    headerShapes: page.rows
      .filter((row) => row.y < page.height * 0.25)
      .map((row) => sourceSafeShape(row.text))
      .filter((shape) => shape.length > 2)
      .slice(0, 12),
  }));
  const columns = (schema?.columns ?? []).map((column) => ({
    role: column.role,
    x: Math.round(column.xStart / Math.max(1, column.referencePageWidth ?? pages[0]?.width ?? 1) * 100),
    width: Math.round((column.xEnd - column.xStart) / Math.max(1, column.referencePageWidth ?? pages[0]?.width ?? 1) * 100),
  }));
  return fnv1aHex(JSON.stringify({ pageCountBand: Math.min(pages.length, 10), pageShapes, columns }));
}

export function matchPdfLayoutProfile(
  profile: PdfLayoutProfile,
  pages: PdfReconstructedPage[],
  schema: PdfTableSchema | null
): PdfProfileMatch {
  const fingerprint = createPdfLayoutFingerprint(pages, schema);
  if (fingerprint === profile.fingerprint) return { outcome: "strong", score: 1, reasons: ["layout fingerprint matches"], drift: false };
  const expectedRoles = new Set(profile.guidance.columns.map((column) => column.role));
  const actualRoles = new Set((schema?.columns ?? []).map((column) => column.role));
  const overlap = [...expectedRoles].filter((role) => actualRoles.has(role)).length / Math.max(1, expectedRoles.size);
  const geometryDistance = columnGeometryDistance(profile, pages, schema);
  const geometryScore = Math.max(0, 1 - geometryDistance * 4);
  const score = overlap * 0.7 + geometryScore * 0.3;
  const drift = overlap < 0.8 || geometryDistance > 0.06;
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

function columnGeometryDistance(
  profile: PdfLayoutProfile,
  pages: PdfReconstructedPage[],
  schema: PdfTableSchema | null
) {
  const currentWidth = pages[0]?.width ?? 1;
  const savedWidth = profile.sourcePage.width || 1;
  const distances = profile.guidance.columns.flatMap((saved) => {
    const current = schema?.columns.find((column) => column.role === saved.role);
    if (!current) return [];
    const savedReferenceWidth = saved.referencePageWidth ?? savedWidth;
    const currentReferenceWidth = current.referencePageWidth ?? currentWidth;
    const start = Math.abs(saved.xStart / savedReferenceWidth - current.xStart / currentReferenceWidth);
    const end = Math.abs(saved.xEnd / savedReferenceWidth - current.xEnd / currentReferenceWidth);
    return [(start + end) / 2];
  });
  // A single moved financial column is material even when every other column
  // still aligns, so use the worst mapped-column drift rather than averaging
  // it away across the table.
  return distances.length ? Math.max(...distances) : 1;
}

export function createPdfLayoutProfile(input: {
  id: string;
  name: string;
  result: { reconstructedPages: PdfReconstructedPage[]; activeSchema: PdfTableSchema | null; guidance: PdfParserGuidance };
  supersedesProfileId?: string | null;
  profileVersion?: number;
}): PdfLayoutProfile {
  const firstPage = input.result.reconstructedPages[0];
  return {
    id: input.id,
    name: input.name,
    parserVersion: 2,
    profileVersion: input.profileVersion ?? 1,
    fingerprint: createPdfLayoutFingerprint(input.result.reconstructedPages, input.result.activeSchema),
    guidance: {
      ...input.result.guidance,
      // A statement period is evidence for this document, not a reusable
      // property of the bank layout. Persisting it would reject next month's
      // otherwise valid dates and retain financial-document metadata.
      statementPeriod: { start: null, end: null },
      columns: input.result.guidance.columns.map((column) => ({ ...column, header: null, examples: [] })),
      regions: input.result.guidance.regions.map((region) => ({ ...region, rowIds: [], reasons: [] })),
    },
    createdAt: new Date().toISOString(),
    supersedesProfileId: input.supersedesProfileId ?? null,
    sourcePage: { width: firstPage?.width ?? 1, height: firstPage?.height ?? 1 },
  };
}

export function guidanceFromPdfLayoutProfile(
  profile: PdfLayoutProfile,
  current: {
    reconstructedPages: PdfReconstructedPage[];
    detectedGuidance: PdfParserGuidance;
    guidance?: PdfParserGuidance;
  }
): PdfParserGuidance {
  const firstPage = current.reconstructedPages[0];
  const scaleX = (firstPage?.width ?? profile.sourcePage.width) / Math.max(1, profile.sourcePage.width);
  const scaleY = (firstPage?.height ?? profile.sourcePage.height) / Math.max(1, profile.sourcePage.height);
  const regions = current.detectedGuidance.regions.map((region) => {
    const candidates = profile.guidance.regions.filter((saved) => saved.pageNumber === region.pageNumber);
    const saved = candidates.sort((left, right) => Math.abs(left.y * scaleY - region.y) - Math.abs(right.y * scaleY - region.y))[0];
    return saved ? { ...region, included: saved.included, kind: saved.kind } : region;
  });
  return {
    ...current.detectedGuidance,
    ...profile.guidance,
    statementPeriod: current.guidance?.statementPeriod ?? current.detectedGuidance.statementPeriod,
    regions,
    columns: profile.guidance.columns.map((column) => ({
      ...column,
      xStart: column.referencePageWidth ? column.xStart : column.xStart * scaleX,
      xEnd: column.referencePageWidth ? column.xEnd : column.xEnd * scaleX,
      examples: [],
      header: null,
    })),
  };
}

export function isPdfLayoutProfileEnvelope(value: unknown): value is PdfLayoutProfileEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<PdfLayoutProfileEnvelope>;
  const profile = envelope.profile as Partial<PdfLayoutProfile> | undefined;
  return envelope.kind === "pdf-layout-v2"
    && profile?.parserVersion === 2
    && typeof profile.id === "string"
    && typeof profile.name === "string"
    && typeof profile.fingerprint === "string"
    && Boolean(profile.guidance)
    && Boolean(profile.sourcePage);
}

/**
 * Rebuild a persisted profile from an allow-list of declarative layout fields.
 * This is the server persistence boundary: even a hand-crafted API request
 * cannot smuggle extracted statement text or PDF bytes into the profile JSON.
 */
export function sanitizePdfLayoutProfileEnvelope(value: unknown): PdfLayoutProfileEnvelope | null {
  if (!isPdfLayoutProfileEnvelope(value)) return null;
  const current = sanitizeProfile(value.profile);
  if (!current) return null;
  const history = (value.history ?? []).map(sanitizeProfile);
  if (history.some((profile) => profile === null)) return null;
  return {
    kind: "pdf-layout-v2",
    profile: current,
    ...(history.length ? { history: history as PdfLayoutProfile[] } : {}),
  };
}

function sanitizeProfile(profile: PdfLayoutProfile): PdfLayoutProfile | null {
  const guidance = profile.guidance;
  if (!guidance || guidance.version !== 1) return null;
  if (!profile.id || !profile.name || !profile.fingerprint || typeof profile.createdAt !== "string") return null;
  if (profile.supersedesProfileId !== null && typeof profile.supersedesProfileId !== "string") return null;
  if (!new Set(["auto", "credit-card", "checking", "savings", "prepaid", "multi-currency", "business-cash", "loan", "investment", "unknown"]).has(guidance.accountType)) return null;
  if (!new Set(["auto", "iso", "dmy", "mdy", "dmy-name", "ymd-compact", "ymd"]).has(guidance.dateFormat)) return null;
  if (!new Set(["auto", "us", "european", "space", "indian", "swiss"]).has(guidance.numberFormat)) return null;
  if (!new Set(["transaction", "posting", "value"]).has(guidance.importDate)) return null;
  if (!new Set(["review", "debit", "credit"]).has(guidance.unsignedDirection)) return null;
  if (!new Set(["transaction-date", "posting-date", "value-date"]).has(guidance.transactionAnchorRole)) return null;
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion < 1) return null;
  if (!Number.isFinite(profile.sourcePage.width) || profile.sourcePage.width <= 0
    || !Number.isFinite(profile.sourcePage.height) || profile.sourcePage.height <= 0) return null;
  if (!Array.isArray(guidance.columns) || !Array.isArray(guidance.regions)) return null;
  if (!guidance.statementPeriod
    || guidance.statementPeriod.start !== null
    || guidance.statementPeriod.end !== null) return null;
  if (guidance.currency !== null && !/^[A-Z]{3}$/.test(guidance.currency)) return null;
  if (!guidance.columns.every((column) =>
    typeof column.id === "string"
    && (column.pageNumber === null || Number.isInteger(column.pageNumber))
    && Number.isFinite(column.xStart)
    && Number.isFinite(column.xEnd)
    && Number.isFinite(column.confidence)
    && (column.referencePageWidth === undefined || Number.isFinite(column.referencePageWidth))
    && new Set(["transaction-date", "posting-date", "value-date", "description", "reference", "debit", "credit", "amount", "direction", "balance", "original-amount", "original-currency", "exchange-rate", "currency", "fee", "vat", "ignore"]).has(column.role)
    && column.header === null
    && Array.isArray(column.examples)
    && column.examples.length === 0
  )) return null;
  if (!guidance.regions.every((region) =>
    typeof region.id === "string"
    && Number.isInteger(region.pageNumber)
    && [region.x, region.y, region.width, region.height, region.confidence].every(Number.isFinite)
    && new Set(["transactions", "summary", "rewards", "installments", "fees", "other"]).has(region.kind)
    && typeof region.included === "boolean"
    && Array.isArray(region.rowIds)
    && region.rowIds.length === 0
    && Array.isArray(region.reasons)
    && region.reasons.length === 0
  )) return null;

  return {
    id: profile.id,
    name: profile.name,
    parserVersion: 2,
    profileVersion: profile.profileVersion,
    fingerprint: profile.fingerprint,
    guidance: {
      version: 1,
      accountType: guidance.accountType,
      currency: guidance.currency,
      statementPeriod: { start: null, end: null },
      dateFormat: guidance.dateFormat,
      numberFormat: guidance.numberFormat,
      importDate: guidance.importDate,
      unsignedDirection: guidance.unsignedDirection,
      transactionAnchorRole: guidance.transactionAnchorRole,
      columns: guidance.columns.map((column) => ({
        id: column.id,
        pageNumber: column.pageNumber,
        ...(column.referencePageWidth === undefined ? {} : { referencePageWidth: column.referencePageWidth }),
        xStart: column.xStart,
        xEnd: column.xEnd,
        role: column.role,
        header: null,
        examples: [],
        confidence: column.confidence,
      })),
      regions: guidance.regions.map((region) => ({
        id: region.id,
        pageNumber: region.pageNumber,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        kind: region.kind,
        included: region.included,
        confidence: region.confidence,
        rowIds: [],
        reasons: [],
      })),
    },
    createdAt: profile.createdAt,
    supersedesProfileId: profile.supersedesProfileId,
    sourcePage: { width: profile.sourcePage.width, height: profile.sourcePage.height },
  };
}
