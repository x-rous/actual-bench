/**
 * One vocabulary for screens, help and the user guide (§9.3, D27). Labels never switch with
 * state; only values and badges change.
 */
/** What an instalment plan is, in one place: the card editor, the Instalment plans tab and the glossary. */
export const INSTALMENT_PLANS_DESCRIPTION = "Purchases, balance transfers or cash the bank lets you repay in instalments";

/** The Credit cards guide's sections; each glossary term points at the one that explains it. */
export type GuideSection = "start" | "monthly" | "statements" | "bills" | "types" | "plans" | "figures" | "keyboard" | "glossary";

export const GLOSSARY: { term: string; definition: string; section: GuideSection }[] = [
  { term: "Statement balance", definition: "The closing balance printed on the bank statement.", section: "statements" },
  { term: "Previous balance", definition: "The previous statement's balance, as printed on this statement.", section: "statements" },
  { term: "Payments & credits", definition: "What the statement prints as paid in or credited during its period; it usually pays the previous bill.", section: "statements" },
  { term: "Charges", definition: "Purchases, cash advances and other debits the statement prints for its period.", section: "statements" },
  { term: "Interest & fees", definition: "Interest and fees the statement charges for its period.", section: "statements" },
  { term: "On this statement · Not on this statement · Unsure", definition: "Your answer for each transaction in a statement review: did the bank print it on this statement?", section: "statements" },
  { term: "Matches bank", definition: "The transactions you put on the statement add up to the bank's balance.", section: "statements" },
  { term: "Difference", definition: "How far the transactions you put on the statement are from the bank's balance.", section: "statements" },
  { term: "Changed since review", definition: "A reviewed transaction changed in Actual after you saved the review.", section: "statements" },
  { term: "Estimate", definition: "A statement Bench expects from the billing days, until you enter the bank's figures.", section: "statements" },
  { term: "Starting point", definition: "The first tracked statement, where history begins.", section: "statements" },
  {
    term: "Amount due",
    definition: "What the bank asks you to pay by the due date; your bank may call this Total Payment Due. Left blank, it is the statement balance.",
    section: "bills",
  },
  { term: "Minimum due", definition: "The smallest payment the bank accepts by the due date.", section: "bills" },
  { term: "Paid · Pending", definition: "Payments toward this bill: cleared in Actual (Paid) or not yet (Pending). Pending never counts as paid.", section: "bills" },
  { term: "Left to pay · Minimum left", definition: "Amount due and Minimum due, each minus Paid.", section: "bills" },
  { term: "Paid in full", definition: "Cleared payments reached the amount due by the due date.", section: "bills" },
  { term: "Unpaid at due date", definition: "In Insights' track record: what was still unpaid when the due date passed. Later payments do not change it.", section: "bills" },
  { term: "Paid since tracking", definition: "In Insights: cleared payments since the first tracked statement.", section: "bills" },
  { term: "Type", definition: "How Bench counts a transaction: Suggested (dotted), From category, Set by you (✓) or From Actual.", section: "types" },
  { term: "Instalment plan", definition: `${INSTALMENT_PLANS_DESCRIPTION}, often at 0%. Bench tracks each one on the card or in a plan account.`, section: "plans" },
  {
    term: "Plan account",
    definition: "An off-budget Actual account that holds instalment-plan balances, often shared by several cards with one #tag per plan. Transfers with it are never payments.",
    section: "plans",
  },
  { term: "Total owed", definition: "Everything you owe for the card today, including plan balances held in plan accounts.", section: "figures" },
  { term: "New since statement", definition: "Card activity after the latest statement closed.", section: "figures" },
  {
    term: "Credit limit",
    definition: "The limit you set for the card, plus any limit changes you record in Settings, each from its effective date. Past figures keep the limit they had.",
    section: "figures",
  },
  { term: "Available credit", definition: "The limit in effect today minus Total owed; Bench's figure, not the bank's live one.", section: "figures" },
  { term: "Credit used", definition: "The share of today's limit Total owed takes up.", section: "figures" },
];

/**
 * Labels the redesign retired (§9.3 "Instead of"). Rendered screens must not show them; the
 * vocabulary test fails if one comes back. Case-sensitive where the word is common.
 */
export const RETIRED_LABELS: RegExp[] = [
  /official balance/i, /billed balance/i, /brought forward/i, /opening balance/i, /opening anchor/i,
  /monthly target/i, /payment target/i, /\bRepaid\b/, /provisional/i, /clearing pending/i,
  /\bTo pay\b/, /Minimum to pay/i, /Carried at due/i, /Payments in period/i, /New charges/i, /Plan charges/i,
  /current debt/i, /Since last statement/i, /Net activity/i, /Utili[sz]ation/i,
  /tracking account/i, /repayment-plan account/i, /Classification/, /\bUndecided\b/i, /membership/i,
  /\bVerified\b/, /Ready to verify/i, /Balance difference/i, /Source changed/i,
  /Debt & history/i, /How to use/i, /\b(Include|Exclude)\b/,
];
