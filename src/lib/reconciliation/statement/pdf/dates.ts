import type { PdfDateFormatOption, PdfFieldConfidence } from "./model";
import { normalizePdfDateText } from "./candidates";

export type PdfDateCandidateResult = {
  value: string | null;
  raw: string | null;
  confidence: PdfFieldConfidence;
};

export function inferPdfDateFormat(
  sampleGroups: string[][],
  period: { start: string | null; end: string | null }
): PdfDateFormatOption {
  const samples = sampleGroups.flat().map(normalizePdfDateText).filter(Boolean);
  if (!samples.length) return "auto";

  let dmyEvidence = 0;
  let mdyEvidence = 0;
  samples.forEach((raw) => {
    if (/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(raw) || /\b\d{8}\b/.test(raw)) {
      return;
    }
    const numeric = raw.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{2,4})?\b/);
    if (!numeric) return;
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    if (first > 12 && second <= 12) dmyEvidence += 1;
    if (second > 12 && first <= 12) mdyEvidence += 1;
  });

  if (dmyEvidence > 0 && mdyEvidence === 0) return "dmy";
  if (mdyEvidence > 0 && dmyEvidence === 0) return "mdy";
  if (dmyEvidence > 0 || mdyEvidence > 0) return "auto";

  const dmy = scoreDateFormat(sampleGroups, "dmy", period);
  const mdy = scoreDateFormat(sampleGroups, "mdy", period);
  if (dmy.valid !== mdy.valid) return dmy.valid > mdy.valid ? "dmy" : "mdy";
  if (dmy.inPeriod !== mdy.inPeriod) return dmy.inPeriod > mdy.inPeriod ? "dmy" : "mdy";
  if (dmy.reversals !== mdy.reversals) return dmy.reversals < mdy.reversals ? "dmy" : "mdy";
  return "auto";
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export function parsePdfDateCandidate(
  rawValue: string | null,
  format: PdfDateFormatOption,
  sourceIds: string[],
  period: { start: string | null; end: string | null }
): PdfDateCandidateResult {
  if (!rawValue) return rejected(null, sourceIds);
  const raw = normalizePdfDateText(rawValue);
  const compact = raw.match(/\b(\d{4})(\d{2})(\d{2})\b/);
  if (compact) {
    return accepted(raw, date(Number(compact[1]), Number(compact[2]), Number(compact[3])), sourceIds);
  }
  const iso = raw.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return accepted(raw, date(Number(iso[1]), Number(iso[2]), Number(iso[3])), sourceIds);

  const textualDmy = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?[-\s]([\p{L}]{3,})\.?(?:[-\s](\d{2,4}))?\b/iu);
  if (textualDmy) {
    const month = MONTHS[textualDmy[2].toLowerCase()];
    const printedYear = textualDmy[3] ? normalizeYear(Number(textualDmy[3])) : null;
    const year = printedYear ?? inferYear(Number(textualDmy[1]), month ?? 0, period);
    return month && year
      ? result(raw, date(year, month, Number(textualDmy[1])), sourceIds, printedYear ? [] : ["DATE_YEAR_INFERRED_FROM_PERIOD"])
      : rejected(raw, sourceIds);
  }
  const textualMdy = raw.match(/\b([\p{L}]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?\b/iu);
  if (textualMdy) {
    const month = MONTHS[textualMdy[1].toLowerCase()];
    const printedYear = textualMdy[3] ? normalizeYear(Number(textualMdy[3])) : null;
    const year = printedYear ?? inferYear(Number(textualMdy[2]), month ?? 0, period);
    return month && year
      ? result(raw, date(year, month, Number(textualMdy[2])), sourceIds, printedYear ? [] : ["DATE_YEAR_INFERRED_FROM_PERIOD"])
      : rejected(raw, sourceIds);
  }

  const numeric = raw.match(/\b(\d{1,4})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if (!numeric) return rejected(raw, sourceIds);
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const printedYear = numeric[3] ? normalizeYear(Number(numeric[3])) : null;
  const inferredReason = printedYear ? [] : ["DATE_YEAR_INFERRED_FROM_PERIOD" as const];

  if (format === "ymd" || (numeric[1].length === 4 && numeric[3])) {
    return result(raw, date(first, second, Number(numeric[3])), sourceIds, inferredReason);
  }
  if (format === "dmy" || format === "dmy-name") {
    const year = printedYear ?? inferYearForMonth(second, period);
    return year ? result(raw, date(year, second, first), sourceIds, inferredReason) : rejected(raw, sourceIds);
  }
  if (format === "mdy") {
    const year = printedYear ?? inferYearForMonth(first, period);
    return year ? result(raw, date(year, first, second), sourceIds, inferredReason) : rejected(raw, sourceIds);
  }
  if (format === "iso" || format === "ymd-compact") return rejected(raw, sourceIds);

  if (first > 12 && second <= 12) {
    const year = printedYear ?? inferYearForMonth(second, period);
    return year ? result(raw, date(year, second, first), sourceIds, inferredReason) : rejected(raw, sourceIds);
  }
  if (second > 12 && first <= 12) {
    const year = printedYear ?? inferYearForMonth(first, period);
    return year ? result(raw, date(year, first, second), sourceIds, inferredReason) : rejected(raw, sourceIds);
  }
  const dmyYear = printedYear ?? inferYearForMonth(second, period);
  const mdyYear = printedYear ?? inferYearForMonth(first, period);
  if (!dmyYear || !mdyYear) return rejected(raw, sourceIds);
  const dmy = date(dmyYear, second, first);
  const mdy = date(mdyYear, first, second);
  const alternatives = [
    ...(dmy ? [{ value: dmy, label: "Day / month / year", score: 0.5 }] : []),
    ...(mdy && mdy !== dmy ? [{ value: mdy, label: "Month / day / year", score: 0.5 }] : []),
  ];
  return {
    value: null,
    raw,
    confidence: {
      status: "rejected",
      score: 0.5,
      reasons: ["DATE_AMBIGUOUS_ORDER", ...inferredReason],
      sourceIds,
      alternatives,
    },
  };
}

function inferYear(dayOrMonth: number, monthOrDay: number, period: { start: string | null; end: string | null }) {
  const possibleMonth = monthOrDay >= 1 && monthOrDay <= 12 ? monthOrDay : dayOrMonth;
  return inferYearForMonth(possibleMonth, period);
}

function scoreDateFormat(
  sampleGroups: string[][],
  format: "dmy" | "mdy",
  period: { start: string | null; end: string | null }
) {
  let valid = 0;
  let inPeriod = 0;
  let reversals = 0;
  sampleGroups.forEach((group) => {
    const values = group.flatMap((raw) => {
      const parsed = parsePdfDateCandidate(raw, format, [], period).value;
      if (!parsed) return [];
      valid += 1;
      if ((!period.start || parsed >= period.start) && (!period.end || parsed <= period.end)) inPeriod += 1;
      return [parsed];
    });
    const signs = values.slice(1).flatMap((value, index) => value === values[index] ? [] : [value > values[index] ? 1 : -1]);
    const ascendingBreaks = signs.filter((sign) => sign < 0).length;
    const descendingBreaks = signs.filter((sign) => sign > 0).length;
    reversals += Math.min(ascendingBreaks, descendingBreaks);
  });
  return { valid, inPeriod, reversals };
}

function inferYearForMonth(month: number, period: { start: string | null; end: string | null }) {
  if (month < 1 || month > 12) return null;
  const bounds = [period.start, period.end].filter((value): value is string => Boolean(value));
  if (!bounds.length) return null;
  const candidates = [...new Set(bounds.map((value) => Number(value.slice(0, 4))))];
  if (candidates.length === 1) return candidates[0];
  const matching = candidates.filter((year) => {
    const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastOfMonth = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
    return (!period.end || firstOfMonth <= period.end) && (!period.start || lastOfMonth >= period.start);
  });
  return matching.length === 1 ? matching[0] : null;
}

function result(
  raw: string,
  value: string | null,
  sourceIds: string[],
  reasons: PdfFieldConfidence["reasons"]
): PdfDateCandidateResult {
  if (!value) return rejected(raw, sourceIds);
  return {
    value,
    raw,
    confidence: { status: reasons.length ? "review" : "accepted", score: reasons.length ? 0.82 : 1, reasons, sourceIds },
  };
}

function accepted(raw: string, value: string | null, sourceIds: string[]): PdfDateCandidateResult {
  return value ? { value, raw, confidence: { status: "accepted", score: 1, reasons: [], sourceIds } } : rejected(raw, sourceIds);
}

function rejected(raw: string | null, sourceIds: string[]): PdfDateCandidateResult {
  return { value: null, raw, confidence: { status: "rejected", score: 0, reasons: ["DATE_INVALID"], sourceIds } };
}

function normalizeYear(year: number) {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function date(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
