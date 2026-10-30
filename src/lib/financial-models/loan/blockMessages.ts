import type { BlockReason } from "./model";

/**
 * What a calculation restriction means to the person who hit it, in plain words.
 *
 * The engines refuse a loan with technical text (`use bench-daily`, `projection@1`). Every screen that shows a
 * refusal goes through here instead, so one rule decides the wording and what the person can do about it:
 *
 * - `switch`: interest worked out once per repayment period cannot follow this; calculating day by day can.
 * - `fix`: something in the loan's data or terms needs changing.
 * - `unsupported`: this kind of loan or schedule is not calculated yet.
 *
 * Pure and client-safe (types only), so the browser and the server explain a refusal the same way.
 */

export type BlockCategory = "switch" | "fix" | "unsupported";

export type PlainBlock = { text: string; category: BlockCategory };

/** The codes the once-per-period calculation raises that a day-by-day calculation does not. */
export const SWITCHABLE_BLOCK_CODES: ReadonlySet<BlockReason["code"]> = new Set(["offsets-need-daily-engine", "irregular-event", "mid-period-rate-change", "irregular-first-period"]);

/** An engine's own sentence with its internal names replaced, for a refusal this file has no wording for. */
function scrub(message: string): string {
  return message
    .replace(/use bench-daily or /gi, "")
    .replace(/;?\s*use bench-daily\.?/gi, ".")
    .replace(/bench-daily(@\d+)?/gi, "day-by-day calculation")
    .replace(/bench-periodic(@\d+)?/gi, "per-period calculation")
    .replace(/\b(projection|periodic|daily)@\d+\b/gi, "this calculation")
    .replace(/configuration version \d+/gi, "this version")
    .replace(/\.\./g, ".");
}

const on = (date: string | null) => (date ? ` on ${date}` : "");

export function explainBlock(reason: Pick<BlockReason, "code" | "message" | "date">): PlainBlock {
  const { code, message, date } = reason;
  switch (code) {
    case "irregular-event":
      return { category: "switch", text: `A payment, draw or fee${on(date)} falls between repayment dates. Interest is worked out once per repayment period, which cannot follow a transaction in the middle of one.` };
    case "mid-period-rate-change":
      return { category: "switch", text: `The interest rate changes${on(date)}, part-way through a repayment period. A once-per-period calculation cannot split a period, so move the change to the start of a period or calculate day by day.` };
    case "offsets-need-daily-engine":
      return { category: "switch", text: "An offset changes the interest every day, which a once-per-period calculation cannot follow." };
    case "irregular-first-period":
      // The calculation restarts from the loan's real history; the date is the last real event, not a mistake of the user.
      return /anchor/i.test(message)
        ? { category: "switch", text: `The loan's real history includes a transaction${on(date)}, part-way through a repayment period. Interest worked out once per period cannot restart from the middle of one.` }
        : { category: "switch", text: "The first repayment period is not a full period, so interest has to be worked out day by day." };
    case "negative-amortization":
      return { category: "fix", text: `The repayment${on(date)} does not cover the interest charged for its period, so the balance would grow. Check your lender's terms: if interest is charged and added to the balance before repayment, select the lender's charging frequency under Set calculation method → Interest → Interest is charged, and check the dates. If the contract permits unpaid interest to be added to the balance when a repayment falls short, enable “The contract allows negative amortization” under Set calculation method → Repayment. Also check that the Contract repayment amount matches your lender's terms.` };
    case "negative-repayment":
      return { category: "fix", text: `A repayment${on(date)} has a negative amount. Check the amounts you entered.` };
    case "rate-gap":
      return { category: "fix", text: `No interest rate applies${on(date)}. Add a rate that starts on or before that date.` };
    case "missing-payment":
      return { category: "fix", text: "The loan needs a first repayment date and a repayment amount (or enough terms to work them out) before it can be scheduled." };
    case "unsupported-profile":
    case "inconsistent-profile":
      if (/business-day/i.test(message)) return { category: "switch", text: "Moving repayment dates to business days needs interest to be worked out day by day." };
      if (/semi-monthly|custom/i.test(message)) return { category: "unsupported", text: "Repayments that are not on a regular weekly, fortnightly, monthly, quarterly or yearly schedule cannot be calculated yet." };
      return { category: "unsupported", text: `This combination of calculation settings is not supported yet. ${scrub(message)}`.trim() };
    default:
      return { category: "unsupported", text: scrub(message) };
  }
}

/** Every distinct reason in plain words, and whether calculating day by day would lift at least one of them. */
export function explainBlocks(reasons: readonly Pick<BlockReason, "code" | "message" | "date">[]): { texts: string[]; canSwitch: boolean } {
  const explained = reasons.map(explainBlock);
  return { texts: [...new Set(explained.map((e) => e.text))], canSwitch: explained.some((e) => e.category === "switch") };
}
