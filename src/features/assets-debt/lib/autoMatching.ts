import type { ActualBenchTransport } from "@/lib/actual/transport";
import { localToday } from "./calendarDate";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { DebtBacktestResult } from "@/lib/financial-models/matching";
import { checkDraftMatchRule, createMatchRule, getSchedule, listMatchRules } from "./debtsApi";
import { readFreshMatchingHistory } from "./freshHistory";
import { defaultActions, recommendedSettings, settingsToConditions } from "./matchingRuleBuilder";

/**
 * Repayment matching set up with a new loan (owner decision 2026-10-06). When the loan is first
 * saved with its loan account and the account repayments are paid from, Bench saves the suggested
 * repayment rule and checks it against the history since the loan started. A clean check (no
 * matched payment Bench could never change) turns the rule on, even with missed due dates, which
 * show on Sync Repayments; otherwise the rule is saved off and opens in the matching editor.
 * Actual is only read.
 */

export type AutoMatchingResult =
  | { status: "on"; ruleId: string; check: DebtBacktestResult }
  | { status: "needs-review"; ruleId: string; check: DebtBacktestResult | null; message: string | null }
  | { status: "skipped"; reason: "accounts-missing" | "has-rules" | "not-active" };

const isoToday = () => localToday();
const inDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Clean as the matching editor counts it: nothing Bench could never change (missed due dates show on Sync Repayments). */
export const checkIsClean = (check: DebtBacktestResult) => check.summary.multiple === 0 && check.summary.unsafe === 0;

export async function setUpRepaymentMatching(detail: DebtDetail, transport: ActualBenchTransport, today = isoToday()): Promise<AutoMatchingResult> {
  const { debt } = detail;
  if (debt.status !== "active" || !detail.config.ok) return { status: "skipped", reason: "not-active" };
  if (!debt.paymentAccountId || !debt.liabilityAccountId) return { status: "skipped", reason: "accounts-missing" };
  if ((await listMatchRules(debt.id)).length) return { status: "skipped", reason: "has-rules" };
  const terms = detail.config.config.terms;
  // The contractual repayment, or else the next one the schedule projects.
  let expectedPaymentMinor = terms.contractualPaymentMinor;
  if (expectedPaymentMinor === null) {
    const next = await getSchedule(debt.id, { from: today < terms.openingDate ? terms.openingDate : today, to: inDays(today < terms.openingDate ? terms.openingDate : today, 400), resolution: "events" });
    expectedPaymentMinor = next.ok ? Math.abs(next.events.find((e) => e.eventType === "repayment")?.cashMovementMinor ?? 0) || null : null;
  }
  const settings = recommendedSettings({
    purpose: "repayment",
    paymentAccountId: debt.paymentAccountId,
    liabilityAccountId: debt.liabilityAccountId,
    signConvention: debt.signConvention === "positive-is-debt" ? "positive-is-debt" : "negative-is-debt",
    expectedPaymentMinor,
    toleranceMinor: debt.driftToleranceMinor ?? 100,
    repaymentFrequency: detail.config.config.profile?.repaymentFrequency ?? null,
  });
  const rule = { purpose: "repayment" as const, conditions: settingsToConditions(settings), actions: defaultActions() };
  const from = terms.openingDate <= today ? terms.openingDate : today;
  let check: DebtBacktestResult | null = null;
  let message: string | null = null;
  try {
    const snapshots = await readFreshMatchingHistory(transport, { accountIds: [debt.paymentAccountId, debt.liabilityAccountId], from, to: today });
    check = await checkDraftMatchRule(debt.id, { rule, from, to: today, snapshots });
    if (checkIsClean(check)) {
      try {
        const saved = await createMatchRule(debt.id, { ...rule, enabled: true }, { from, to: today, snapshots });
        return { status: "on", ruleId: saved.record.id, check };
      } catch (error) {
        // The server's own gate refused it (for example a weak rule): save it off instead.
        message = error instanceof Error ? error.message : String(error);
      }
    }
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const saved = await createMatchRule(debt.id, { ...rule, enabled: false });
  return { status: "needs-review", ruleId: saved.record.id, check, message };
}

/** Where to go after the setup, and what to say: Sync Repayments when matching is on, else the editor. */
export function afterMatchingSetup(result: AutoMatchingResult, debtId: string, path: (id: string, query?: string) => string): { href: string | null; message: string | null; tone: "success" | "warning" } {
  if (result.status === "skipped") return { href: null, message: null, tone: "success" };
  if (result.status === "on") {
    const found = result.check.summary.unique;
    const missed = result.check.summary.missing;
    const base = found ? `Repayment matching is on: ${found} repayment${found === 1 ? "" : "s"} found in Actual.` : "Repayment matching is on. Bench looks for each repayment as it falls due.";
    return { href: path(debtId, "view=repayments"), message: missed ? `${base} ${missed} due date${missed === 1 ? " has" : "s have"} no payment yet; choose ${missed === 1 ? "it" : "them"} on Sync Repayments if paid.` : base, tone: "success" };
  }
  const attention = result.check ? result.check.summary.missing + result.check.summary.multiple + result.check.summary.unsafe : 0;
  return {
    href: path(debtId, `view=link&rule=${encodeURIComponent(result.ruleId)}`),
    message: attention ? `Check repayment matching: ${attention} due date${attention === 1 ? " needs" : "s need"} attention before it is turned on.` : "Check repayment matching before it is turned on.",
    tone: "warning",
  };
}
