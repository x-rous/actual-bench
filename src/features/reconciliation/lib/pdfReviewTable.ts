import type { SortDirection } from "@/components/ui/sortable-header";
import type {
  PdfAccountType,
  PdfColumn,
  PdfColumnRole,
  PdfRegionKind,
  PdfStatementParseResult,
  PdfTransactionProposal,
} from "@/lib/reconciliation/statement/pdf";

/**
 * The parts of the PDF review table that are arithmetic rather than markup:
 * what the rows are worth, how they sort, which view they belong to, and what
 * a set of detection settings would change about them.
 *
 * They live outside the component so they can be tested as what they are -
 * functions over parser output - rather than through a rendered dialog.
 */

export type PdfSortColumn =
  | "status"
  | "transactionDate"
  | "postedDate"
  | "valueDate"
  | "description"
  | "amount"
  | "currency"
  | "balance";

export type PdfSortState = { key: PdfSortColumn; direction: Exclude<SortDirection, null> } | null;

export type PdfReviewCategory =
  | "all"
  | "needs-review"
  | "ready"
  | "structure"
  | "dates"
  | "amounts"
  | "reconciliation"
  | "duplicates"
  | "manual";

export function nextSortState(current: PdfSortState, key: PdfSortColumn, direction: SortDirection): PdfSortState {
  return direction === null ? null : { key, direction };
}

const STATUS_SORT_ORDER: Record<PdfTransactionProposal["status"], number> = {
  rejected: 0,
  review: 1,
  accepted: 2,
};

export function sortTransactions(rows: PdfTransactionProposal[], sort: PdfSortState) {
  if (!sort) return rows;
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    // A row with nothing to compare stays at the end in both directions, so
    // reversing the sort never hides the rows that still need a value.
    const missingLeft = isMissingForSort(left, sort.key);
    const missingRight = isMissingForSort(right, sort.key);
    if (missingLeft !== missingRight) return missingLeft ? 1 : -1;
    const compared = compareTransactions(left, right, sort.key);
    // Rows the sort cannot separate keep the statement's own order.
    return compared === 0 ? left.sourceRowNumber - right.sourceRowNumber : compared * factor;
  });
}

export function isMissingForSort(row: PdfTransactionProposal, column: PdfSortColumn) {
  if (column === "status" || column === "description" || column === "amount") return false;
  if (column === "currency") return !row.currency;
  if (column === "balance") return !row.balance;
  return !row[column];
}

export function compareTransactions(
  left: PdfTransactionProposal,
  right: PdfTransactionProposal,
  column: PdfSortColumn
) {
  if (column === "status") return STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
  if (column === "amount") return minorUnits(left.amount) - minorUnits(right.amount);
  if (column === "balance") return compareOptionalNumbers(left.balance, right.balance);
  if (column === "description") return left.description.localeCompare(right.description);
  if (column === "currency") return compareOptionalText(left.currency, right.currency);
  return compareOptionalText(left[column], right[column]);
}

function compareOptionalText(left: string | null, right: string | null) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

function compareOptionalNumbers(left: string | null, right: string | null) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return minorUnits(left) - minorUnits(right);
}

export function matchesCategory(row: PdfTransactionProposal, category: PdfReviewCategory): boolean {
  if (category === "all") return true;
  if (category === "needs-review") return row.status !== "accepted";
  if (category === "ready") return row.status === "accepted";
  if (category === "manual") return row.issueCodes.includes("ROW_MANUALLY_CHANGED");
  if (row.status === "accepted") return false;
  if (category === "structure") {
    return row.issueCodes.some((reason) =>
      (reason.startsWith("ROW_") && reason !== "ROW_MANUALLY_CHANGED") || reason === "PAGE_IMAGE_ONLY");
  }
  if (category === "dates") return row.issueCodes.some((reason) => reason.startsWith("DATE_"));
  if (category === "amounts") {
    return row.issueCodes.some((reason) =>
      reason.startsWith("AMOUNT_") || reason.startsWith("DIRECTION_") || reason.startsWith("CURRENCY_"));
  }
  if (category === "reconciliation") return row.issueCodes.some((reason) => reason.startsWith("BALANCE_"));
  if (category === "duplicates") return row.issueCodes.includes("POSSIBLE_DUPLICATE");
  return false;
}

export function matchesSearch(row: PdfTransactionProposal, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return row.description.toLowerCase().includes(query)
    || row.amount.includes(query)
    || Boolean(row.importDate?.includes(query));
}

export function transactionTotals(rows: PdfTransactionProposal[]) {
  return rows.reduce((total, row) => {
    const units = minorUnits(row.amount);
    if (units > 0) total.credits += units;
    if (units < 0) total.debits += Math.abs(units);
    return total;
  }, { credits: 0, debits: 0 });
}

export function minorUnits(value: string) {
  const match = value.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0;
  return Number(`${match[1]}${match[2]}${(match[3] ?? "").padEnd(2, "0")}`);
}

export function formatGroupedDecimal(value: string) {
  const match = value.match(/^([+-]?)(\d+)(\.\d+)?$/);
  return match
    ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}`
    : value;
}

export function formatTableAmount(value: string) {
  return formatGroupedDecimal(value.replace(/^[+-]/, ""));
}

export function normalizeTableAmountInput(value: string) {
  const sign = value.startsWith("-") ? "-" : "";
  const unsigned = value.replace(/^[+-]/, "").trim();
  return /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(unsigned) ? `${sign}${unsigned.replaceAll(",", "")}` : value;
}

/** The statement's own name, with a csv extension and no directory parts. */
export function csvFileNameFor(fileName: string) {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[\\/]/g, "-").trim();
  return `${base || "pdf-statement"}.csv`;
}

export function accountTypeLabel(type: PdfAccountType) {
  return ({
    "credit-card": "Credit card",
    checking: "Checking / current",
    savings: "Savings",
    prepaid: "Prepaid card / wallet",
    "multi-currency": "Multi-currency account",
    "business-cash": "Business cash account",
    loan: "Loan / line of credit",
    investment: "Investment statement",
    unknown: "Account type not identified",
  } satisfies Record<PdfAccountType, string>)[type];
}

export const PDF_COLUMN_ROLE_GROUPS: { label: string; roles: { value: PdfColumnRole; label: string }[] }[] = [
  { label: "Dates", roles: [
    { value: "transaction-date", label: "Transaction date" },
    { value: "posting-date", label: "Posting date" },
    { value: "value-date", label: "Value date" },
  ] },
  { label: "Transaction details", roles: [
    { value: "description", label: "Description" },
    { value: "reference", label: "Reference" },
  ] },
  { label: "Account values", roles: [
    { value: "amount", label: "Amount" },
    { value: "debit", label: "Money out" },
    { value: "credit", label: "Money in" },
    { value: "direction", label: "DR / CR marker" },
    { value: "currency", label: "Currency" },
    { value: "balance", label: "Balance" },
  ] },
  { label: "Foreign-currency details", roles: [
    { value: "original-amount", label: "Original-currency amount" },
    { value: "original-currency", label: "Original currency" },
    { value: "exchange-rate", label: "Exchange rate" },
  ] },
  { label: "Charges", roles: [
    { value: "fee", label: "Fee" },
    { value: "vat", label: "VAT / tax" },
  ] },
  { label: "Exclude", roles: [
    { value: "ignore", label: "Ignore this column" },
  ] },
];

const COLUMN_ROLE_LABELS = new Map(
  PDF_COLUMN_ROLE_GROUPS.flatMap((group) => group.roles.map((role) => [role.value, role.label] as const))
);

/**
 * One name per column role, wherever it appears.
 *
 * The overlay on the page used to print the role's own slug, so a column
 * offered as "Money out" in the mapping list was labelled "debit" on the PDF
 * beside it. Two names for one thing reads as two things.
 */
export function columnRoleLabel(role: PdfColumnRole) {
  return COLUMN_ROLE_LABELS.get(role) ?? role.replaceAll("-", " ");
}

export function regionKindLabel(kind: PdfRegionKind) {
  return ({
    transactions: "Transactions",
    summary: "Summary",
    rewards: "Rewards",
    installments: "Installments",
    fees: "Fees",
    other: "Other",
  } satisfies Record<PdfRegionKind, string>)[kind];
}

export function financialDetails(row: PdfTransactionProposal) {
  return [
    row.originalAmount ? `Original ${formatExactMoney(row.originalAmount)}` : null,
    row.exchangeRate ? `Rate ${row.exchangeRate}` : null,
    row.fees.length ? `Fees ${row.fees.map(formatExactMoney).join(" + ")}` : null,
    row.vat.length ? `VAT ${row.vat.map(formatExactMoney).join(" + ")}` : null,
  ].filter(Boolean).join(" · ");
}

export function formatExactMoney(value: NonNullable<PdfTransactionProposal["exactAmount"]>) {
  const coefficient = BigInt(value.coefficient);
  const magnitude = (coefficient < BigInt(0) ? -coefficient : coefficient).toString().padStart(value.scale + 1, "0");
  const decimal = value.scale ? `${magnitude.slice(0, -value.scale)}.${magnitude.slice(-value.scale)}` : magnitude;
  return `${value.currency ? `${value.currency} ` : ""}${decimal}`;
}

export function formatSignedMinorUnitsWithSign(value: number, format: (value: number) => string) {
  return `${value > 0 ? "+" : ""}${format(value)}`;
}

/**
 * Pair the transactions in two results, so a preview can say what changed
 * about a row rather than reporting the row twice.
 *
 * A transaction's id is its block's anchor row. That holds still for most
 * detection edits, but moving a transaction area's top edge gives a block a
 * new anchor - and then the same printed transaction reads as one removed and
 * one added, which is the opposite of what a preview is for. Nothing else in
 * the result is a true identity either: the supporting token ids move with the
 * anchor, and the source row number renumbers when a row is added above.
 *
 * So: pair first on what a reader would use to recognize the row - the page it
 * is printed on, its amount, and its description - and only then on the id,
 * for rows whose values were read differently. That order matters. Matching
 * ids first pairs the wrong rows outright when every anchor shifts by one:
 * the second row's old id is the third row's new id. Only rows that survive
 * both passes are counted as added or removed, because only those have
 * nothing on the other side to be.
 */
function pairTransactions(before: PdfTransactionProposal[], after: PdfTransactionProposal[]) {
  const pairs: { left: PdfTransactionProposal; right: PdfTransactionProposal }[] = [];
  const unmatchedBefore = new Map(before.map((row) => [row.id, row]));
  const unmatchedAfter = new Map(after.map((row) => [row.id, row]));

  const recognition = (row: PdfTransactionProposal) =>
    `${row.raw.pageNumber}|${row.amount}|${row.description}`;
  const byRecognition = new Map<string, PdfTransactionProposal[]>();
  for (const row of unmatchedAfter.values()) {
    const key = recognition(row);
    byRecognition.set(key, [...(byRecognition.get(key) ?? []), row]);
  }
  for (const [id, left] of unmatchedBefore) {
    const right = byRecognition.get(recognition(left))?.shift();
    if (!right) continue;
    pairs.push({ left, right });
    unmatchedBefore.delete(id);
    unmatchedAfter.delete(right.id);
  }

  for (const [id, left] of unmatchedBefore) {
    const right = unmatchedAfter.get(id);
    if (!right) continue;
    pairs.push({ left, right });
    unmatchedBefore.delete(id);
    unmatchedAfter.delete(id);
  }

  return { pairs, added: unmatchedAfter.size, removed: unmatchedBefore.size };
}

export function resultDiff(before: PdfStatementParseResult, after: PdfStatementParseResult) {
  const { pairs, added, removed } = pairTransactions(before.transactions, after.transactions);
  let amounts = 0;
  let dates = 0;
  let descriptions = 0;
  for (const { left, right } of pairs) {
    if (left.amount !== right.amount || left.currency !== right.currency) amounts += 1;
    if (left.importDate !== right.importDate
      || left.transactionDate !== right.transactionDate
      || left.postedDate !== right.postedDate
      || left.valueDate !== right.valueDate) dates += 1;
    if (left.description !== right.description) descriptions += 1;
  }
  const beforeTotals = transactionTotals(before.transactions);
  const afterTotals = transactionTotals(after.transactions);
  return {
    before: before.transactions.length,
    after: after.transactions.length,
    added,
    removed,
    amounts,
    dates,
    descriptions,
    changed: added + removed + amounts + dates + descriptions,
    beforeReady: before.metrics.accepted,
    afterReady: after.metrics.accepted,
    beforeReview: before.metrics.review + before.metrics.rejected,
    afterReview: after.metrics.review + after.metrics.rejected,
    beforeRejected: before.metrics.rejected,
    afterRejected: after.metrics.rejected,
    beforeCredits: beforeTotals.credits,
    afterCredits: afterTotals.credits,
    beforeDebits: beforeTotals.debits,
    afterDebits: afterTotals.debits,
    beforeNet: beforeTotals.credits - beforeTotals.debits,
    afterNet: afterTotals.credits - afterTotals.debits,
  };
}

export type PdfResultDiff = ReturnType<typeof resultDiff>;

export function pageForSourceIds(
  result: PdfStatementParseResult | null,
  sourceIds: string[],
  fallback: number
) {
  if (!result || sourceIds.length === 0) return fallback;
  const ids = new Set(sourceIds);
  const matches = result.reconstructedPages
    .map((page) => ({
      pageNumber: page.pageNumber,
      matches: page.tokens.filter((token) => ids.has(token.id)).length,
    }))
    .filter((page) => page.matches > 0)
    .sort((left, right) => right.matches - left.matches || left.pageNumber - right.pageNumber);
  return matches[0]?.pageNumber ?? fallback;
}

/**
 * Where a newly mapped column goes: after the last one when the page has room
 * there, otherwise in the widest gap between the columns already mapped.
 */
export function newColumnBounds(columns: PdfColumn[], pageNumber: number, pageWidth: number) {
  const edgePadding = Math.max(6, pageWidth * 0.01);
  const gap = Math.max(8, pageWidth * 0.012);
  const preferredWidth = Math.min(72, Math.max(50, pageWidth * 0.1));
  const minimumWidth = Math.min(40, preferredWidth);
  const intervals = columns
    .filter((column) => column.pageNumber === null || column.pageNumber === pageNumber)
    .map((column) => {
      const scale = column.referencePageWidth && column.referencePageWidth > 0
        ? pageWidth / column.referencePageWidth
        : 1;
      return {
        start: Math.max(edgePadding, column.xStart * scale),
        end: Math.min(pageWidth - edgePadding, column.xEnd * scale),
      };
    })
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start)
    .reduce<{ start: number; end: number }[]>((merged, interval) => {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ ...interval });
      return merged;
    }, []);

  if (intervals.length === 0) {
    const center = pageWidth / 2;
    return { xStart: center - preferredWidth / 2, xEnd: center + preferredWidth / 2 };
  }

  const lastEnd = intervals.at(-1)!.end;
  const trailingStart = lastEnd + gap;
  const trailingEnd = Math.min(pageWidth - edgePadding, trailingStart + preferredWidth);
  if (trailingEnd - trailingStart >= minimumWidth) return { xStart: trailingStart, xEnd: trailingEnd };

  const openSpaces = [
    { start: edgePadding, end: intervals[0].start },
    ...intervals.slice(0, -1).map((interval, index) => ({ start: interval.end, end: intervals[index + 1].start })),
  ]
    .map((space) => ({ start: space.start + gap, end: space.end - gap }))
    .filter((space) => space.end - space.start >= minimumWidth)
    .sort((left, right) => (right.end - right.start) - (left.end - left.start));
  const available = openSpaces[0];
  if (available) return { xStart: available.start, xEnd: Math.min(available.end, available.start + preferredWidth) };

  const center = pageWidth / 2;
  return {
    xStart: Math.max(edgePadding, center - preferredWidth / 2),
    xEnd: Math.min(pageWidth - edgePadding, center + preferredWidth / 2),
  };
}

export function boxesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
) {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) > 0
    && Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)) > 0;
}
