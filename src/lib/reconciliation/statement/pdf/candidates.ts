import type { PdfNumberFormat } from "./model";
import { normalizePdfText } from "./text";

export const DATE_CANDIDATE = /\b(?:\d{8}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|\d{1,2}(?:st|nd|rd|th)?[-\s][\p{L}]{3,}\.?(?:[-\s]\d{2,4})?|[\p{L}]{3,}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?)\b/iu;
export const CURRENCY_CANDIDATE = /\b(?:AED|AUD|BHD|CAD|CHF|CNY|DKK|EGP|EUR|GBP|HKD|INR|JPY|KWD|NOK|NZD|OMR|QAR|SAR|SEK|SGD|USD|ZAR)\b|[$£€¥₹]/iu;
export const MONEY_CANDIDATE = /(?:\(\s*)?[+-]?\s*(?:(?:AED|AUD|BHD|CAD|CHF|CNY|DKK|EGP|EUR|GBP|HKD|INR|JPY|KWD|NOK|NZD|OMR|QAR|SAR|SEK|SGD|USD|ZAR|[$£€¥₹])\s*)?(?:\d{1,3}(?:[\s,'’.,]\d{2,3})+|\d+)(?:[.,]\d{1,6})?\s*(?:CR|DR)?\s*\)?/giu;

export type ExactDecimal = {
  coefficient: bigint;
  scale: number;
  raw: string;
  ambiguous: boolean;
};

export function looksLikeDate(value: string) {
  return dateCandidates(value).length > 0;
}

export function dateCandidates(value: string) {
  const text = normalizePdfDateText(value);
  const patterns = [
    /\b(?:\d{8}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)\b/giu,
    /\b(?:\d{1,2}(?:st|nd|rd|th)?[-\s][\p{L}]{3,}\.?(?:[-\s]\d{2,4})?|[\p{L}]{3,}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?)\b/giu,
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({
    raw: match[0],
    index: match.index ?? 0,
  })))
    .filter(({ raw }) => validDateCandidate(raw))
    .sort((left, right) => left.index - right.index)
    .filter((entry, index, entries) => entries.findIndex((candidate) =>
      candidate.index === entry.index && candidate.raw === entry.raw
    ) === index)
    .map((entry) => entry.raw);
}

export function normalizePdfDateText(value: string) {
  return normalizePdfText(value)
    .replace(/(\d)\s*([/.-])\s*(?=\d)/g, "$1$2")
    .replace(/(\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2})\s+(\d{2}\b)/g, "$1$2");
}

function validDateCandidate(match: string) {
  const textualDmy = match.match(/^(\d{1,2})(?:st|nd|rd|th)?[-\s]([\p{L}]{3,})/iu);
  if (textualDmy) {
    return Number(textualDmy[1]) >= 1
      && Number(textualDmy[1]) <= 31
      && isMonthName(textualDmy[2]);
  }
  const textualMdy = match.match(/^([\p{L}]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?/iu);
  if (textualMdy) {
    return isMonthName(textualMdy[1])
      && Number(textualMdy[2]) >= 1
      && Number(textualMdy[2]) <= 31;
  }
  if (/^\d{8}$/.test(match)) {
    const year = Number(match.slice(0, 4));
    const month = Number(match.slice(4, 6));
    const day = Number(match.slice(6, 8));
    return year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
  }
  const numeric = match.match(/^(\d{1,4})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
  if (!numeric) return true;
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  if (numeric[1].length === 4) return first >= 1900 && second >= 1 && second <= 12 && Boolean(numeric[3]);
  return first >= 1 && first <= 31 && second >= 1 && second <= 31 && (first <= 12 || second <= 12);
}

function isMonthName(value: string) {
  return /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i.test(value);
}

export function moneyCandidates(value: string) {
  const text = normalizePdfText(value);
  MONEY_CANDIDATE.lastIndex = 0;
  return [...text.matchAll(MONEY_CANDIDATE)]
    .map((match) => match[0].trim())
    .filter((candidate) => /\d/.test(candidate));
}

export function parseExactDecimal(value: string, format: PdfNumberFormat): ExactDecimal | null {
  const raw = normalizePdfText(value);
  const negative = /^\s*-/.test(raw) || /^\s*\(/.test(raw) || /(?<!\p{L})DR(?!\p{L})/iu.test(raw);
  let numeric = raw
    .replace(CURRENCY_CANDIDATE, "")
    .replace(/(?<!\p{L})(?:CR|DR)(?!\p{L})/giu, "")
    .replace(/[()+-]/g, "")
    .replace(/[’']/g, "'")
    .trim();
  if (!/\d/.test(numeric)) return null;

  const detected = format === "auto" ? detectNumberFormat(numeric) : { format, ambiguous: false };
  const decimal = decimalSeparator(detected.format, numeric);
  const groupingPattern = decimal === "," ? /[.\s']/g : /[,\s']/g;
  numeric = numeric.replace(groupingPattern, "");
  if (decimal === ",") numeric = numeric.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return null;
  const [whole, fraction = ""] = numeric.split(".");
  const coefficient = BigInt(`${negative ? "-" : ""}${whole}${fraction}`);
  return { coefficient, scale: fraction.length, raw, ambiguous: detected.ambiguous };
}

export function formatExactDecimal(value: ExactDecimal, sign: "debit" | "credit" | "unknown") {
  const magnitude = (value.coefficient < BigInt(0) ? -value.coefficient : value.coefficient).toString();
  const padded = magnitude.padStart(value.scale + 1, "0");
  const whole = value.scale === 0 ? padded : padded.slice(0, -value.scale);
  const fraction = value.scale === 0 ? "" : `.${padded.slice(-value.scale)}`;
  return `${sign === "debit" ? "-" : ""}${whole}${fraction}`;
}

function detectNumberFormat(value: string): { format: Exclude<PdfNumberFormat, "auto">; ambiguous: boolean } {
  if (/\d{1,3}(?:,\d{2})+,\d{3}\.\d+$/.test(value) || /\d{1,2},\d{2},\d{3}(?:\.\d+)?$/.test(value)) {
    return { format: "indian", ambiguous: false };
  }
  if (/\d['’]\d{3}/.test(value)) return { format: "swiss", ambiguous: false };
  if (/\d\s\d{3}/.test(value)) return { format: "space", ambiguous: false };
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) return { format: comma > dot ? "european" : "us", ambiguous: false };
  if (comma >= 0) {
    const tail = value.length - comma - 1;
    return { format: tail === 3 ? "us" : "european", ambiguous: tail === 3 };
  }
  if (dot >= 0) {
    const tail = value.length - dot - 1;
    return { format: "us", ambiguous: tail === 3 };
  }
  return { format: "us", ambiguous: false };
}

function decimalSeparator(format: Exclude<PdfNumberFormat, "auto">, value: string): "." | "," | null {
  if (format === "european") return value.includes(",") ? "," : null;
  if (format === "space" || format === "swiss") {
    const comma = value.lastIndexOf(",");
    const dot = value.lastIndexOf(".");
    if (comma < 0 && dot < 0) return null;
    return comma > dot ? "," : ".";
  }
  if (format === "us" || format === "indian") {
    return value.includes(".") ? "." : null;
  }
  return null;
}
