import type { DebtMatchPurpose } from "@/lib/app-db/types";
import type { DirectoryAccount, DirectoryCategory } from "@/lib/assets-debt/actual/ledgerPort";
import { parseMatchConditionsV1, type MatchActionsV1, type MatchConditionsV1 } from "@/lib/financial-models/matching";
import { formatAmount } from "./money";

/**
 * Structured matching settings ↔ matching DSL v1 (RD-084 P1.6 T280; FR-075a).
 *
 * People never edit the DSL JSON. They pick a Recommended setup built from the
 * debt's Tracking setup and, if they want, adjust it with structured controls.
 * This module turns those settings into the existing, persisted
 * `rd084.debt-match-conditions` v1 envelope and back. It changes nothing in the
 * DSL or the evaluator: every generated rule goes through the same parser, and
 * the two mandatory safety exclusions are always appended.
 *
 * Pure and exact: amounts are integer minor units; percentages are basis points.
 */

type Condition = MatchConditionsV1["items"][number];

export type AmountFilter =
  | { mode: "any" }
  | { mode: "exact"; amountMinor: number }
  | { mode: "approximate"; amountMinor: number; tolerance: { kind: "absolute"; amountMinor: number } | { kind: "percent"; bps: number } }
  | { mode: "between"; minMinor: number; maxMinor: number };

export type MatchingSettings = {
  sourceAccountId: string;
  direction: "outflow" | "inflow" | "either";
  amount: AmountFilter;
  /** The window around each expected date from the debt's schedule. */
  daysEarly: number;
  daysLate: number;
  dayOfMonth: number | null;
  category: { mode: "any" } | { mode: "empty" } | { mode: "exact"; categoryId: string };
  transfer: "any" | "none" | "present";
  split: "any" | "single" | "child";
  reconciled: "any" | "unreconciled";
  cleared: "any" | "cleared" | "uncleared";
  importedPayeeContains: string;
  notesContains: string;
  /** Valid conditions these controls do not edit (a specific payee, lists); kept verbatim. */
  preserved: Condition[];
};

export type RecommendationInput = {
  purpose: DebtMatchPurpose;
  paymentAccountId: string | null;
  liabilityAccountId: string | null;
  signConvention: "negative-is-debt" | "positive-is-debt";
  /** The contractual repayment, or the next projected one; null when neither is known. */
  expectedPaymentMinor: number | null;
  /** The debt's configured tolerance (drift tolerance), used as the amount tolerance. */
  toleranceMinor: number;
  /** How often repayments fall due; sets how many days either side of a due date to look. */
  repaymentFrequency?: string | null;
};

export const DEFAULT_DAYS = { repayment: { early: 3, late: 3 }, lender: { early: 5, late: 5 } } as const;

/**
 * Days either side of a due date the suggested repayment rule looks (owner decision 2026-10-06):
 * wide enough for a payment made early or late, never wide enough to reach the next repayment.
 */
export function repaymentDays(frequency: string | null | undefined): { early: number; late: number } {
  switch (frequency) {
    case "weekly": return { early: 2, late: 2 };
    case "fortnightly":
    case "semi-monthly": return { early: 4, late: 4 };
    case "monthly":
    case "quarterly":
    case "annual": return { early: 10, late: 10 };
    default: return DEFAULT_DAYS.repayment;
  }
}

function base(sourceAccountId: string): MatchingSettings {
  return {
    sourceAccountId, direction: "either", amount: { mode: "any" }, daysEarly: 3, daysLate: 3, dayOfMonth: null, category: { mode: "any" },
    transfer: "any", split: "any", reconciled: "any", cleared: "any", importedPayeeContains: "", notesContains: "", preserved: [],
  };
}

/** The Recommended setup for a purpose, from Tracking setup. */
export function recommendedSettings(input: RecommendationInput): MatchingSettings {
  // In a negative-is-debt loan account a repayment raises the balance (inflow) and a charge lowers it (outflow).
  const repaymentIntoLoan = input.signConvention === "negative-is-debt" ? "inflow" : "outflow";
  const chargeIntoLoan = repaymentIntoLoan === "inflow" ? "outflow" : "inflow";
  if (input.purpose === "repayment") {
    return {
      ...base(input.paymentAccountId ?? ""),
      direction: "outflow",
      amount: input.expectedPaymentMinor !== null && input.expectedPaymentMinor > 0
        ? { mode: "approximate", amountMinor: input.expectedPaymentMinor, tolerance: { kind: "absolute", amountMinor: Math.max(0, input.toleranceMinor) } }
        : { mode: "any" },
      daysEarly: repaymentDays(input.repaymentFrequency).early,
      daysLate: repaymentDays(input.repaymentFrequency).late,
    };
  }
  return {
    ...base(input.liabilityAccountId ?? ""),
    direction: input.purpose === "interest-charge" ? chargeIntoLoan : repaymentIntoLoan,
    daysEarly: DEFAULT_DAYS.lender.early,
    daysLate: DEFAULT_DAYS.lender.late,
  };
}

const SAFETY: Condition[] = [{ kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }];

/** Settings → the persisted DSL v1 conditions, validated by the existing parser. */
export function settingsToConditions(settings: MatchingSettings): MatchConditionsV1 {
  const items: Condition[] = [];
  if (settings.sourceAccountId) items.push({ kind: "source-account", accountId: settings.sourceAccountId });
  const amount = settings.amount;
  if (amount.mode === "exact") items.push({ kind: "amount", operator: "exact", amountMinor: amount.amountMinor, direction: settings.direction });
  if (amount.mode === "approximate") {
    items.push({
      kind: "amount", operator: "approximate", amountMinor: amount.amountMinor, direction: settings.direction,
      tolerance: amount.tolerance.kind === "absolute" ? { kind: "absolute", amountMinor: amount.tolerance.amountMinor } : { kind: "basis-points", bps: amount.tolerance.bps },
    });
  }
  if (amount.mode === "between") items.push({ kind: "amount", operator: "between", minMinor: amount.minMinor, maxMinor: amount.maxMinor, direction: settings.direction });
  if (amount.mode === "any" && settings.direction !== "either") items.push({ kind: "amount", operator: "between", minMinor: 0, maxMinor: Number.MAX_SAFE_INTEGER, direction: settings.direction });
  items.push({ kind: "expected-date", daysBefore: settings.daysEarly, daysAfter: settings.daysLate });
  if (settings.dayOfMonth !== null) items.push({ kind: "day-of-month", day: settings.dayOfMonth });
  if (settings.category.mode === "empty") items.push({ kind: "category", operator: "empty" });
  if (settings.category.mode === "exact") items.push({ kind: "category", operator: "exact", categoryId: settings.category.categoryId });
  if (settings.transfer !== "any") items.push({ kind: "transfer-state", value: settings.transfer });
  if (settings.split !== "any") items.push({ kind: "split-state", value: settings.split });
  if (settings.reconciled !== "any") items.push({ kind: "reconciled-state", value: settings.reconciled });
  if (settings.cleared !== "any") items.push({ kind: "cleared-state", value: settings.cleared });
  if (settings.importedPayeeContains.trim()) items.push({ kind: "imported-payee", operator: "contains", value: settings.importedPayeeContains.trim() });
  if (settings.notesContains.trim()) items.push({ kind: "notes", operator: "contains", value: settings.notesContains.trim() });
  items.push(...settings.preserved, ...SAFETY);
  return parseMatchConditionsV1({ format: "rd084.debt-match-conditions", version: 1, operator: "all", items });
}

export type SettingsRead = { ok: true; settings: MatchingSettings } | { ok: false; reason: string };

/** DSL v1 → settings. Anything the controls cannot show faithfully is preserved verbatim or reported. */
export function conditionsToSettings(conditions: MatchConditionsV1): SettingsRead {
  if (conditions.operator !== "all") return { ok: false, reason: "This rule matches when any condition holds; the structured editor only builds rules where every condition must hold." };
  const settings = { ...base(""), daysEarly: 0, daysLate: 0 };
  let sawDate = false;
  let sawSource = false;
  for (const item of conditions.items) {
    switch (item.kind) {
      case "source-account":
        if (sawSource) settings.preserved.push(item);
        else { settings.sourceAccountId = item.accountId; sawSource = true; }
        break;
      case "amount":
        if (settings.amount.mode !== "any" || settings.direction !== "either") { settings.preserved.push(item); break; }
        settings.direction = item.direction;
        if (item.operator === "exact") settings.amount = { mode: "exact", amountMinor: item.amountMinor };
        else if (item.operator === "approximate") settings.amount = { mode: "approximate", amountMinor: item.amountMinor, tolerance: item.tolerance.kind === "absolute" ? { kind: "absolute", amountMinor: item.tolerance.amountMinor } : { kind: "percent", bps: item.tolerance.bps } };
        else if (item.minMinor === 0 && item.maxMinor === Number.MAX_SAFE_INTEGER) settings.amount = { mode: "any" };
        else settings.amount = { mode: "between", minMinor: item.minMinor, maxMinor: item.maxMinor };
        break;
      case "expected-date":
        if (sawDate) settings.preserved.push(item);
        else { settings.daysEarly = item.daysBefore; settings.daysLate = item.daysAfter; sawDate = true; }
        break;
      case "day-of-month": settings.dayOfMonth = item.day; break;
      case "category":
        if (item.operator === "empty") settings.category = { mode: "empty" };
        else if (item.operator === "exact") settings.category = { mode: "exact", categoryId: item.categoryId };
        else settings.preserved.push(item);
        break;
      case "transfer-state": settings.transfer = item.value; break;
      case "split-state":
        if (item.value === "parent") settings.preserved.push(item);
        else settings.split = item.value;
        break;
      case "reconciled-state":
        if (item.value === "reconciled") settings.preserved.push(item);
        else settings.reconciled = item.value;
        break;
      case "cleared-state": settings.cleared = item.value; break;
      case "imported-payee":
        if (item.operator === "contains" && !settings.importedPayeeContains) settings.importedPayeeContains = item.value;
        else settings.preserved.push(item);
        break;
      case "notes":
        if (item.operator === "contains" && !settings.notesContains) settings.notesContains = item.value;
        else settings.preserved.push(item);
        break;
      case "bench-marker":
      case "posting-link":
        break;
      default:
        settings.preserved.push(item);
    }
  }
  if (!sawDate) return { ok: false, reason: "This rule has no expected-date window; the structured editor always matches around the scheduled dates." };
  return { ok: true, settings };
}

export function defaultActions(): MatchActionsV1 {
  return { format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] };
}

const DIRECTION_TEXT = { outflow: "money out", inflow: "money in", either: "money in or out" } as const;

/** A plain-language description of what the settings match. */
export function describeSettings(settings: MatchingSettings, accounts: readonly DirectoryAccount[], categories: readonly DirectoryCategory[], minorDigits: number, currency: string): string {
  const account = accounts.find((a) => a.id === settings.sourceAccountId)?.name ?? "the chosen account";
  const money = (minor: number) => `${formatAmount(minor, minorDigits)} ${currency}`;
  const a = settings.amount;
  const amount = a.mode === "exact" ? `exactly ${money(a.amountMinor)}`
    : a.mode === "approximate" ? `${money(a.amountMinor)} ± ${a.tolerance.kind === "absolute" ? money(a.tolerance.amountMinor) : `${formatAmount(a.tolerance.bps, 2)}%`}`
      : a.mode === "between" ? `between ${money(a.minMinor)} and ${money(a.maxMinor)}`
        : "any amount";
  const parts = [
    `${DIRECTION_TEXT[settings.direction]} in ${account}, ${amount}`,
    `from ${settings.daysEarly} day${settings.daysEarly === 1 ? "" : "s"} early to ${settings.daysLate} day${settings.daysLate === 1 ? "" : "s"} late around each scheduled date`,
  ];
  if (settings.dayOfMonth !== null) parts.push(`on day ${settings.dayOfMonth} of the month`);
  if (settings.category.mode === "empty") parts.push("uncategorized only");
  if (settings.category.mode === "exact") {
    const exact = settings.category;
    parts.push(`categorized as ${categories.find((c) => c.id === exact.categoryId)?.name ?? "the chosen category"}`);
  }
  if (settings.transfer !== "any") parts.push(settings.transfer === "none" ? "not a transfer" : "already a transfer");
  if (settings.split !== "any") parts.push(settings.split === "single" ? "not split" : "a split line");
  if (settings.reconciled === "unreconciled") parts.push("not reconciled");
  if (settings.cleared !== "any") parts.push(settings.cleared);
  if (settings.importedPayeeContains.trim()) parts.push(`bank text contains "${settings.importedPayeeContains.trim()}"`);
  if (settings.notesContains.trim()) parts.push(`notes contain "${settings.notesContains.trim()}"`);
  if (settings.preserved.length) parts.push(`${settings.preserved.length} more condition${settings.preserved.length === 1 ? "" : "s"} kept from the existing rule`);
  return `Matches ${parts.join("; ")}. Rows Bench created or already posted are always excluded.`;
}

/** The rule in one short line for the Settings card: "A payment out of X of about Y (± Z), up to 3 days either side of each due date". */
export function ruleSentence(settings: MatchingSettings, accounts: readonly DirectoryAccount[], minorDigits: number): string {
  const account = accounts.find((a) => a.id === settings.sourceAccountId)?.name ?? "the chosen account";
  const where = settings.direction === "outflow" ? `out of ${account}` : settings.direction === "inflow" ? `into ${account}` : `in ${account}`;
  const a = settings.amount;
  const money = (minor: number) => formatAmount(minor, minorDigits);
  const amount = a.mode === "exact" ? ` of exactly ${money(a.amountMinor)}`
    : a.mode === "approximate" ? ` of about ${money(a.amountMinor)} (± ${a.tolerance.kind === "absolute" ? money(a.tolerance.amountMinor) : `${formatAmount(a.tolerance.bps, 2)}%`})`
      : a.mode === "between" ? ` between ${money(a.minMinor)} and ${money(a.maxMinor)}`
        : "";
  const days = settings.daysEarly === settings.daysLate
    ? `up to ${settings.daysEarly} day${settings.daysEarly === 1 ? "" : "s"} either side of each due date`
    : `from ${settings.daysEarly} day${settings.daysEarly === 1 ? "" : "s"} before to ${settings.daysLate} after each due date`;
  const more = settings.dayOfMonth !== null || settings.category.mode !== "any" || settings.transfer !== "any" || settings.split !== "any" || settings.reconciled !== "any" || settings.cleared !== "any" || settings.importedPayeeContains.trim() || settings.notesContains.trim() || settings.preserved.length;
  return `A payment ${where}${amount}, ${days}${more ? ", with more conditions" : ""}`;
}
