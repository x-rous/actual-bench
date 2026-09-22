/**
 * Privacy-safe synthetic scenarios that exercise the PDF parser without
 * committing source statements or extracted customer data.
 *
 * This registry is test metadata, not a runtime parser configuration. Regional
 * labels describe formatting evidence only; schema families are the primary
 * coverage dimension because the parser must remain bank-independent.
 */

export const PDF_FIXTURE_TEST_NAMES = {
  rtlBilingual: "uses the PDF.js viewport transform and retains mixed RTL/LTR source text",
  dualDateDebitCredit: "maps physical debit and credit columns and groups wrapped descriptions",
  crossPageBlock: "carries a wrapped description across a page boundary using that page's height",
  multilineFinancialBlock: "keeps a long final block and selects its lower mapped account total",
  suppressedDate: "starts a new transaction when a complete row suppresses its repeated date",
  controlRows: "excludes balance-forward and total control rows inside a transaction region",
  feeTaxClassification: "keeps fee and tax components in their dated block but separates a later undated fee transaction",
  multiColumnDescription: "combines multiple mapped narrative columns in source order",
  independentDateColumns: "infers date order independently for each mapped date column",
  crossYearPartialDates: "detects a cross-year statement period and applies it to dates without a year",
  countryNumberFormats: "parses a complete %s transaction without changing its exact amount",
  originalAndAccountAmount: "retains original currency, exchange rate, fees, and VAT separately",
  directionIndicator: "uses a standalone %s direction indicator",
  sectionDirection: "uses explicit debit and credit section headings for unsigned amounts",
  singleAmountCr: "uses one Amount column with an attached CR suffix and an explicit unmarked direction rule",
  runningBalance: "reconciles running balances for multiple transactions on the same date",
  availableBalance: "does not use an available-balance column as running-balance evidence",
  withdrawalDeposit: "maps withdrawal and deposit columns to money out and money in",
  dualDateReference: "keeps transaction date, posting date, reference, and amount separate",
  valueDateDebitCredit: "keeps booking and value dates separate with debit and credit columns",
  multiSection: "keeps primary and supplementary card transactions in separate sections",
  periodicBalance: "classifies sparse daily balances without using them as running evidence",
  rtlTransaction: "parses a complete mixed RTL/LTR transaction with Arabic digits",
  dateLikeNarrative: "keeps date-like description text out of mapped date fields",
} as const;

export const PDF_SCHEMA_FAMILY_IDS = [
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13",
  "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23", "F24", "F25", "F26",
] as const;

export type PdfSchemaFamilyId = typeof PDF_SCHEMA_FAMILY_IDS[number];
export type PdfFixtureCoverageStatus = "covered" | "partial" | "pending" | "deferred";
export type PdfFixtureTestName = typeof PDF_FIXTURE_TEST_NAMES[keyof typeof PDF_FIXTURE_TEST_NAMES];

export type PdfFixtureManifestEntry = {
  id: string;
  stage: "positioned-text" | "parser";
  testName: PdfFixtureTestName;
  schemaFamilies: readonly PdfSchemaFamilyId[];
  accountTypes: readonly string[];
  currencies: readonly string[];
  localeFamilies: readonly string[];
  expected: {
    variants?: number;
    transactions?: number;
    sections?: readonly string[];
    outcome?: "accepted" | "review" | "rejected" | "mixed";
  };
  challenges: readonly string[];
};

export const PDF_FIXTURE_MANIFEST = [
  {
    id: "rtl-bilingual-positioned-text",
    stage: "positioned-text",
    testName: PDF_FIXTURE_TEST_NAMES.rtlBilingual,
    schemaFamilies: ["F19"],
    accountTypes: ["credit-card"],
    currencies: ["AED"],
    localeFamilies: ["GCC / Middle East"],
    expected: { variants: 1 },
    challenges: ["mixed RTL/LTR", "Arabic digits", "rotated viewport"],
  },
  {
    id: "dual-date-debit-credit-wrapped",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.dualDateDebitCredit,
    schemaFamilies: ["F3", "F5", "F20"],
    accountTypes: ["credit-card"],
    currencies: ["AED", "SAR"],
    localeFamilies: ["GCC / Middle East"],
    expected: { transactions: 2, sections: ["transactions"] },
    challenges: ["transaction and posting dates", "debit/credit columns", "wrapped description", "summary exclusion"],
  },
  {
    id: "cross-page-transaction-block",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.crossPageBlock,
    schemaFamilies: ["F20", "F22"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["Generic"],
    expected: { transactions: 2, sections: ["transactions"] },
    challenges: ["cross-page continuation", "wrapped description", "next transaction boundary"],
  },
  {
    id: "multiline-financial-final-amount",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.multilineFinancialBlock,
    schemaFamilies: ["F10", "F11"],
    accountTypes: ["credit-card"],
    currencies: ["AED", "SAR"],
    localeFamilies: ["GCC / Middle East"],
    expected: { transactions: 1, sections: ["transactions"], outcome: "review" },
    challenges: ["original amount", "fee and VAT components", "lower final account amount", "multiple amount candidates"],
  },
  {
    id: "suppressed-date-running-balance",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.suppressedDate,
    schemaFamilies: ["F14", "F23"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["North America", "Latin America"],
    expected: { transactions: 3, sections: ["transactions"] },
    challenges: ["suppressed repeated dates", "inherited date evidence", "partial dates", "running balance"],
  },
  {
    id: "balance-control-rows",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.controlRows,
    schemaFamilies: ["F24"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["Generic"],
    expected: { transactions: 2, sections: ["transactions"] },
    challenges: ["balance forward", "total row", "control-row exclusion"],
  },
  {
    id: "fee-tax-component-versus-ledger-row",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.feeTaxClassification,
    schemaFamilies: ["F25"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["South Asia", "Generic"],
    expected: { transactions: 2, sections: ["transactions"] },
    challenges: ["fee component", "tax component", "standalone fee transaction", "suppressed date"],
  },
  {
    id: "multi-column-description",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.multiColumnDescription,
    schemaFamilies: ["F13", "F20"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 1, sections: ["transactions"], outcome: "accepted" },
    challenges: ["counterparty and description columns", "independent reference", "deterministic source order", "source traceability"],
  },
  {
    id: "independent-dual-date-inference",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.independentDateColumns,
    schemaFamilies: ["F5", "F23"],
    accountTypes: ["credit-card"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 2, sections: ["transactions"], outcome: "accepted" },
    challenges: ["different date orders by mapped column", "transaction date", "posting date"],
  },
  {
    id: "cross-year-partial-dates",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.crossYearPartialDates,
    schemaFamilies: ["F23"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 2, sections: ["transactions"], outcome: "accepted" },
    challenges: ["dates without year", "statement-period inference", "year boundary"],
  },
  {
    id: "international-number-formats",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.countryNumberFormats,
    schemaFamilies: ["F1"],
    accountTypes: ["checking"],
    currencies: ["USD", "EUR", "INR", "CHF", "AED", "JPY"],
    localeFamilies: ["US", "Continental Europe", "India", "Switzerland", "GCC / Middle East", "East Asia"],
    expected: { variants: 7, transactions: 1, sections: ["transactions"], outcome: "accepted" },
    challenges: ["decimal comma", "space grouping", "Indian grouping", "apostrophe grouping", "Arabic digits", "zero-decimal currency"],
  },
  {
    id: "original-and-account-amount",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.originalAndAccountAmount,
    schemaFamilies: ["F10"],
    accountTypes: ["credit-card"],
    currencies: ["AED", "SAR", "USD"],
    localeFamilies: ["GCC / Middle East", "International"],
    expected: { transactions: 1, sections: ["transactions"] },
    challenges: ["original currency", "original amount", "exchange rate", "fees", "VAT", "account amount"],
  },
  {
    id: "amount-direction-indicator",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.directionIndicator,
    schemaFamilies: ["F8"],
    accountTypes: ["checking", "credit-card"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { variants: 4, transactions: 1, sections: ["transactions"], outcome: "accepted" },
    challenges: ["separate D/C indicator", "D and C markers", "Debit and Credit labels"],
  },
  {
    id: "section-derived-direction",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.sectionDirection,
    schemaFamilies: ["F16"],
    accountTypes: ["credit-card"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 2, sections: ["purchases", "payments/credits"], outcome: "accepted" },
    challenges: ["one unsigned amount column", "purchases section", "payments and credits section"],
  },
  {
    id: "single-amount-cr-policy",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.singleAmountCr,
    schemaFamilies: ["F1", "F9"],
    accountTypes: ["credit-card"],
    currencies: ["USD"],
    localeFamilies: ["Australia / New Zealand", "International"],
    expected: { transactions: 2, sections: ["transactions"], outcome: "accepted" },
    challenges: ["attached CR suffix", "unsigned debit", "explicit direction policy"],
  },
  {
    id: "running-balance-reconciliation",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.runningBalance,
    schemaFamilies: ["F2"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 3, sections: ["transactions"], outcome: "accepted" },
    challenges: ["running booked balance", "same-date transactions", "balance-derived direction"],
  },
  {
    id: "available-balance-safety",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.availableBalance,
    schemaFamilies: ["F18"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 3, sections: ["transactions"], outcome: "rejected" },
    challenges: ["available balance", "unsafe running-balance inference", "unresolved direction"],
  },
  {
    id: "withdrawal-deposit-columns",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.withdrawalDeposit,
    schemaFamilies: ["F4"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["North America", "South Asia"],
    expected: { transactions: 2, sections: ["transactions"], outcome: "accepted" },
    challenges: ["withdrawal synonym", "deposit synonym", "running balance column"],
  },
  {
    id: "dual-date-reference-amount",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.dualDateReference,
    schemaFamilies: ["F6"],
    accountTypes: ["credit-card"],
    currencies: ["USD"],
    localeFamilies: ["North America", "International"],
    expected: { transactions: 1, sections: ["transactions"], outcome: "accepted" },
    challenges: ["transaction date", "posting date", "reference", "signed amount"],
  },
  {
    id: "booking-value-debit-credit",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.valueDateDebitCredit,
    schemaFamilies: ["F7"],
    accountTypes: ["checking"],
    currencies: ["EUR"],
    localeFamilies: ["Europe", "International"],
    expected: { transactions: 2, sections: ["transactions"], outcome: "accepted" },
    challenges: ["booking date", "value date", "debit column", "credit column"],
  },
  {
    id: "multiple-card-sections",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.multiSection,
    schemaFamilies: ["F17"],
    accountTypes: ["credit-card"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 2, sections: ["primary card", "supplementary card"], outcome: "accepted" },
    challenges: ["primary card section", "supplementary card section", "section identity"],
  },
  {
    id: "periodic-daily-balance",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.periodicBalance,
    schemaFamilies: ["F18"],
    accountTypes: ["checking"],
    currencies: ["USD"],
    localeFamilies: ["International"],
    expected: { transactions: 3, sections: ["transactions"], outcome: "accepted" },
    challenges: ["daily balance", "sparse balance cells", "non-running validation"],
  },
  {
    id: "rtl-bilingual-transaction",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.rtlTransaction,
    schemaFamilies: ["F19"],
    accountTypes: ["credit-card"],
    currencies: ["AED"],
    localeFamilies: ["GCC / Middle East"],
    expected: { transactions: 1, sections: ["transactions"], outcome: "accepted" },
    challenges: ["mixed RTL/LTR transaction", "Arabic digits", "mapped direction"],
  },
  {
    id: "date-like-description-text",
    stage: "parser",
    testName: PDF_FIXTURE_TEST_NAMES.dateLikeNarrative,
    schemaFamilies: ["F26"],
    accountTypes: ["checking"],
    currencies: ["GBP"],
    localeFamilies: ["Europe", "International"],
    expected: { transactions: 1, sections: ["transactions"], outcome: "accepted" },
    challenges: ["time in description", "date in description", "mapped date authority"],
  },
] as const satisfies readonly PdfFixtureManifestEntry[];

export type PdfSchemaFamilyCoverage = {
  id: PdfSchemaFamilyId;
  name: string;
  status: PdfFixtureCoverageStatus;
  fixtureIds: readonly string[];
  remaining?: string;
};

/**
 * Parser-fixture coverage against the F1-F26 matrix. "Covered" means a named,
 * active synthetic parser regression exists; it does not override separate
 * release-readiness findings about safety, extraction, or downstream mapping.
 */
export const PDF_SCHEMA_FAMILY_COVERAGE = [
  { id: "F1", name: "Single amount", status: "covered", fixtureIds: ["international-number-formats", "single-amount-cr-policy"] },
  { id: "F2", name: "Single amount with running balance", status: "covered", fixtureIds: ["running-balance-reconciliation"] },
  { id: "F3", name: "Debit / credit", status: "covered", fixtureIds: ["dual-date-debit-credit-wrapped"] },
  { id: "F4", name: "Withdrawal / deposit", status: "covered", fixtureIds: ["withdrawal-deposit-columns"] },
  { id: "F5", name: "Dual date with amount", status: "covered", fixtureIds: ["dual-date-debit-credit-wrapped", "independent-dual-date-inference"] },
  { id: "F6", name: "Dual date with reference and amount", status: "covered", fixtureIds: ["dual-date-reference-amount"] },
  { id: "F7", name: "Value date with debit / credit", status: "covered", fixtureIds: ["booking-value-debit-credit"] },
  { id: "F8", name: "Amount with debit / credit indicator", status: "covered", fixtureIds: ["amount-direction-indicator"] },
  { id: "F9", name: "Amount with CR / DR marker", status: "covered", fixtureIds: ["single-amount-cr-policy"] },
  { id: "F10", name: "Original amount with account amount", status: "covered", fixtureIds: ["multiline-financial-final-amount", "original-and-account-amount"] },
  { id: "F11", name: "Original amount with fee, tax, and final amount", status: "covered", fixtureIds: ["multiline-financial-final-amount"] },
  { id: "F12", name: "Three temporal fields", status: "deferred", fixtureIds: [], remaining: "Transaction time is intentionally deferred advanced source metadata and is not required for Actual import." },
  { id: "F13", name: "Rich reference / narrative schema", status: "partial", fixtureIds: ["multi-column-description"], remaining: "Add counterparty, reference, and other-details columns together." },
  { id: "F14", name: "Suppressed repeated date", status: "covered", fixtureIds: ["suppressed-date-running-balance"] },
  { id: "F15", name: "Pending / undated transaction", status: "pending", fixtureIds: [], remaining: "Pending-date import policy is not implemented." },
  { id: "F16", name: "Section-derived direction", status: "covered", fixtureIds: ["section-derived-direction"] },
  { id: "F17", name: "Multiple accounts, cards, or currencies", status: "partial", fixtureIds: ["multiple-card-sections"], remaining: "Card sections are covered; distinct account and currency-section semantics remain partial." },
  { id: "F18", name: "Sparse / daily balance", status: "partial", fixtureIds: ["available-balance-safety", "periodic-daily-balance"], remaining: "Available and periodic classification are covered; group-level sparse/daily reconciliation remains partial." },
  { id: "F19", name: "RTL / bilingual", status: "partial", fixtureIds: ["rtl-bilingual-positioned-text", "rtl-bilingual-transaction"], remaining: "Positioned and parser stages are covered synthetically; real PDF CID/CMap extraction remains partial." },
  { id: "F20", name: "Multiline multi-column description", status: "covered", fixtureIds: ["dual-date-debit-credit-wrapped", "cross-page-transaction-block", "multi-column-description"] },
  { id: "F21", name: "Independent fee direction", status: "pending", fixtureIds: [], remaining: "Charge direction is not represented independently yet." },
  { id: "F22", name: "Cross-page transaction", status: "covered", fixtureIds: ["cross-page-transaction-block"] },
  { id: "F23", name: "Partial dates without year", status: "covered", fixtureIds: ["suppressed-date-running-balance", "independent-dual-date-inference", "cross-year-partial-dates"] },
  { id: "F24", name: "Balance control rows inside activity", status: "covered", fixtureIds: ["balance-control-rows"] },
  { id: "F25", name: "Standalone fee / tax versus component", status: "covered", fixtureIds: ["fee-tax-component-versus-ledger-row"] },
  { id: "F26", name: "Date-like narrative text", status: "covered", fixtureIds: ["date-like-description-text"] },
] as const satisfies readonly PdfSchemaFamilyCoverage[];
