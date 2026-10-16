import type { ActivityRow } from "./activity";
import type { ActivityClassification, Card, Workspace } from "./models";

export type ClassificationKind = ActivityClassification["kind"];
export type ClassificationSuggestion = { kind: ClassificationKind; basis: "Category" | "Suggested" | "Default"; reason: string };
export const costFamily = (kind: string) => ["interest", "interest-refund"].includes(kind) ? "interest" as const : ["fee", "fee-refund"].includes(kind) ? "fee" as const : null;

/** Source descriptions suggest a financial meaning; they never create/link an Actual entry. */
export function recognizeActivity(row: ActivityRow, card: Card): ClassificationSuggestion {
  const notes = /(?:first due|original.{0,15}fixed|links? as|plan terms)/i.test(row.notes ?? "") ? "" : row.notes ?? "";
  const text = `${row.label} ${notes}`.normalize("NFKC").toUpperCase();
  const credit = row.amountMinor > 0;
  const result = (kind: ClassificationKind, reason: string, basis: ClassificationSuggestion["basis"] = "Suggested") => ({ kind, reason, basis });
  if (row.amountMinor === 0) return result("adjustment", "Zero amount; no debt movement", "Default");
  if (row.categoryId && row.categoryId === card.interestCategoryId) return result(credit ? "interest-refund" : "interest", "From interest category", "Category");
  if (row.categoryId && row.categoryId === card.feeCategoryId) return result(credit ? "fee-refund" : "fee", "From fee category", "Category");
  if (credit && row.categoryId && row.categoryId === card.cashbackCategoryId) return result("cashback", "From cashback category", "Category");
  if (/\b(?:FEES?|VAT|GST|TAX ON FEE|TARIFA|FX MARKUP|OVERLIMIT)\b|رسوم/.test(text)) return result(credit ? "fee-refund" : "fee", "Matches fee or fee-tax wording");
  if (!credit && /\b(?:RETURNED PAYMENT|PAYMENT REVERSAL|DD RETURN|REJECTED PAYMENT)\b/.test(text)) return result("adjustment", "Returned-payment wording; this adjustment does not cancel another payment");
  const interestWords = /\b(?:INTEREST|FINANCE CHARGE|FINANCE PROFIT|PROFIT|REVOLVING CHARGE|JUROS)\b/;
  const zeroInterest = /\b(?:SEM JUROS|NO[- ]INTEREST|ZERO[- ]INTEREST|INTEREST[- ]FREE)\b|\b0(?:\.0+)?\s*%\s*(?:APR|INTEREST|PROFIT)\b/;
  if (interestWords.test(row.label.toUpperCase()) && !zeroInterest.test(row.label.toUpperCase()) || interestWords.test(text) && !zeroInterest.test(text)) return result(credit ? "interest-refund" : "interest", "Matches interest or financing-profit wording");
  if (/\b(?:DISPUTE|PROVISIONAL CREDIT|CHARGEBACK)\b/.test(text)) return result(credit ? "dispute-credit" : "dispute-adjustment", "Matches dispute activity; no final resolution assumed");
  if (credit && /\b(?:CASHBACK|REWARDS CREDIT|POINTS REDEMPTION)\b/.test(text)) return result("cashback", "Matches rewards wording");
  if (/\b(?:EPP CONVERSION|PURCHASE CONVERSION|EPP REVERSAL|EMI REVERSAL|EMI CONVERSION|BCP CREDIT|BCP ADJUSTMENT|BALANCE CONVERSION|STATEMENT CONVERSION|BALANCE TRANSFER TO PLAN|PLAN ADJUSTMENT)\b|\bCONVERSION(?: CREDIT)?[;,: -]+(?:MOVES? )?PRINCIPAL\b/.test(text)) return result(credit ? "plan-conversion" : "plan-adjustment", "Matches plan conversion wording; not a customer payment");
  if (/\b(?:PRE-CLOSURE|EARLY SETTLEMENT|FORECLOSURE|INSTALMENT CANCELLATION|INSTALLMENT CANCELLATION)\b|سداد مبكر/.test(text)) return result("plan-adjustment", "Matches plan settlement or adjustment wording");
  if (/\b(?:EMI|EPP|IPP|FIP|FPP|FMP|BCP|CIP|INSTALMENT|INSTALLMENT|PARCELA|PARCELADO|PARCELAMENTO DA FATURA|COMPRA PARCELADA|FLEX PAY|FLEXIPAY|PLAN IT|PAY OVER TIME|SMARTPLAN|EZYPAY|PAYLITE|BUDGET FACILITY)\b|تقسيط|قسط|أقساط/.test(text)) return result(credit ? "plan-adjustment" : "plan-instalment", "Matches instalment wording; choose a plan when useful");
  if (/\b(?:BALANCE TRANSFER|BT PLAN|BT PRINCIPAL|BTP|BTF|CCFT)\b|تحويل رصيد/.test(text)) return result("balance-transfer", "Matches debt-transfer wording");
  if (!credit && /\b(?:ATM CASH|CASH ADVANCE|CASH WITHDRAWAL)\b/.test(text)) return result("cash-advance", "Matches cash-advance wording");
  if (!credit && /\b(?:FUNDS TRANSFER|MONEY TRANSFER|CARD TO BANK|CASH ON CALL|CASH ON CARD|QUICK CASH|LOAN ON CARD|ALOC)\b/.test(text)) return result("money-transfer", "Matches card-funded borrowing wording");
  if (/\b(?:GOODWILL|BALANCE ADJUSTMENT|WRITE OFF|WRITE-OFF)\b/.test(text)) return result("adjustment", "Matches account-adjustment wording");
  // Non-transfer payment recognition/eligibility and payment-return netting are deliberately deferred.
  if (row.transferId) return result(credit ? "payment" : "transfer", credit ? "Incoming external transfer" : "Outgoing transfer", "Default");
  if (credit && /\b(?:REFUND|CREDIT NOTE)\b/.test(text)) return result("refund", "Matches refund wording");
  return result(credit ? "refund" : "purchase", credit ? "Default refund / credit" : "Default purchase", "Default");
}

/** Costs retain their financial type independently of plan association. */
export function recognizedCost(row: ActivityRow, card: Card, workspace: Pick<Workspace, "classifications">) {
  const manual = workspace.classifications.find((entry) => entry.cardId === card.id && entry.transactionId === row.id && entry.fingerprint === row.fingerprint);
  return costFamily(manual?.kind ?? recognizeActivity(row, card).kind);
}
