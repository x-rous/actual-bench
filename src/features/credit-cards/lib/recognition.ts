import type { TransactionType } from "./models";

/**
 * Keyword suggestions: the last rung of the evidence ladder (§7.3). They apply only to
 * uncategorised rows, read the imported payee only (never notes), and use anchored issuer
 * phrases so ordinary merchant names ("PROFIT FITNESS", "EMI MUSIC", "MUSEUM ENTRY FEE") never
 * match. A keyword result is always Suggested; interest and fee suggestions are not counted in
 * cost totals until accepted (A5).
 */
type Rule = {
  kind: TransactionType;
  /** Which sign the rule applies to. */
  sign: "charge" | "credit" | "any";
  pattern: RegExp;
  reason: string;
};

const RULES: readonly Rule[] = [
  {
    kind: "fee",
    sign: "any",
    pattern: /\b(?:ANNUAL|LATE(?: PAYMENT)?|OVER ?LIMIT|FOREIGN (?:TRANSACTION|CURRENCY|EXCHANGE)|CASH ADVANCE|RETURNED PAYMENT|MEMBERSHIP|CARD REPLACEMENT|PLAN PROCESSING) FEES?\b/,
    reason: "Bank fee wording",
  },
  {
    kind: "fee",
    sign: "any",
    pattern: /^(?:VAT|GST|TAX) ON (?:FEES?|INTEREST|CHARGES)\b|\bSERVICE CHARGE\b/,
    reason: "Bank fee or tax-on-fee wording",
  },
  {
    kind: "interest",
    sign: "any",
    pattern: /^(?:PURCHASE |CASH |RETAIL |PLAN )?INTEREST(?: CHARGED?| CHARGES| ON (?:PURCHASES|CASH|BALANCE))?\s*$|^(?:PURCHASE |CASH )?INTEREST CHARGED?\b|\bFINANCE CHARGES?\b|\bINT(?:EREST)? CHG\b|^PROFIT (?:CHARGE|ON BALANCE)\b/,
    reason: "Bank interest wording",
  },
  {
    kind: "instalment",
    sign: "any",
    pattern: /\b(?:EMI|EPP|IPP|INSTAL?LMENT|PARCELA)\s*\d{1,2}\s*(?:\/|OF)\s*\d{1,2}\b|\b(?:EPP|EMI|PURCHASE|BALANCE|STATEMENT) CONVERSION\b/,
    reason: "Instalment plan wording",
  },
  {
    kind: "payment",
    sign: "charge",
    pattern: /^(?:RETURNED|REVERSED|DISHONOU?RED|REJECTED) PAYMENT\b|\bPAYMENT (?:REVERSAL|RETURNED)\b/,
    reason: "Returned-payment wording",
  },
  {
    kind: "payment",
    sign: "credit",
    pattern: /\b(?:PAYMENT|THANK YOU|AUTOPAY|AUTO PAY|DIRECT DEBIT)\b/,
    reason: "Payment wording",
  },
  {
    kind: "cashback",
    sign: "credit",
    pattern: /\b(?:CASHBACK|CASH BACK|REWARDS? CREDIT|POINTS REDEMPTION)\b/,
    reason: "Rewards wording",
  },
  {
    kind: "cash-advance",
    sign: "charge",
    pattern: /\b(?:ATM CASH|CASH ADVANCE|CASH WITHDRAWAL|ATM WITHDRAWAL)\b/,
    reason: "Cash-advance wording",
  },
  {
    kind: "balance-transfer",
    sign: "any",
    pattern: /\bBALANCE TRANSFER\b/,
    reason: "Balance-transfer wording",
  },
  {
    kind: "adjustment",
    sign: "any",
    pattern: /^(?:DISPUTE|CHARGEBACK|PROVISIONAL|GOODWILL)(?: CREDIT| ADJUSTMENT| REVERSAL)\b|\bBALANCE ADJUSTMENT\b/,
    reason: "Bank adjustment wording",
  },
  {
    kind: "refund",
    sign: "credit",
    pattern: /\b(?:REFUND|CREDIT NOTE|RETURN CREDIT)\b/,
    reason: "Refund wording",
  },
];

export type KeywordSuggestion = { kind: TransactionType; reason: string };

/** The first matching issuer phrase on the payee, or null. */
export function keywordType(payee: string, amountMinor: number): KeywordSuggestion | null {
  if (amountMinor === 0) return null;
  const text = payee.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
  const sign = amountMinor > 0 ? "credit" : "charge";
  const rule = RULES.find((entry) => (entry.sign === "any" || entry.sign === sign) && entry.pattern.test(text));
  return rule ? { kind: rule.kind, reason: rule.reason } : null;
}
