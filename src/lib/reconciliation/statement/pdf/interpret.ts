import { cellBelongsToColumn, columnAppliesToPage, columnBoundsForPage, rowValuesForColumn } from "./columns";
import { CURRENCY_CANDIDATE, dateCandidates, formatExactDecimal, looksLikeMoney, moneyCandidates, parseExactDecimal, printedSignOf } from "./candidates";
import { parsePdfDateCandidate, type PdfDateCandidateResult } from "./dates";
import { diagnostic } from "./diagnostics";
import type {
  PdfAccountType,
  PdfBalanceBehavior,
  PdfBalanceCheckpoint,
  PdfBalancePolarity,
  PdfColumn,
  PdfColumnRole,
  PdfDateFormatOption,
  PdfConfidenceReason,
  PdfDiagnosticEvent,
  PdfDirection,
  PdfDirectionEvidence,
  PdfExactMoney,
  PdfFieldConfidence,
  PdfParserGuidance,
  PdfReconstructedPage,
  PdfRegion,
  PdfTableSchema,
  PdfTransactionBlock,
  PdfTransactionProposal,
  PdfVisualCell,
  PdfVisualRow,
} from "./model";

export type PdfInterpretResult = {
  transactions: PdfTransactionProposal[];
  accountType: PdfAccountType;
  /** The account type came from the user or a saved layout, not from page text. */
  accountTypeConfirmed: boolean;
  balanceBehavior: PdfBalanceBehavior;
  balanceCheckpoints: PdfBalanceCheckpoint[];
  balancePolarity: PdfBalancePolarity | null;
  diagnostics: PdfDiagnosticEvent[];
};

/** Row and page lookups built once per run instead of scanning every page. */
export type PdfPageIndex = {
  rowsById: Map<string, PdfVisualRow>;
  widthByPage: Map<number, number>;
  heightByPage: Map<number, number>;
};

export function createPdfPageIndex(pages: PdfReconstructedPage[]): PdfPageIndex {
  const rowsById = new Map<string, PdfVisualRow>();
  const widthByPage = new Map<number, number>();
  const heightByPage = new Map<number, number>();
  pages.forEach((page) => {
    widthByPage.set(page.pageNumber, page.width);
    heightByPage.set(page.pageNumber, page.height);
    page.rows.forEach((row) => rowsById.set(row.id, row));
  });
  return { rowsById, widthByPage, heightByPage };
}

const LIABILITY_ACCOUNT_TYPES: PdfAccountType[] = ["credit-card", "loan"];
const DEPOSIT_ACCOUNT_TYPES: PdfAccountType[] = ["checking", "savings", "prepaid", "multi-currency", "business-cash"];

type DateRole = "transaction-date" | "posting-date" | "value-date";
type DateFormatsByRole = Partial<Record<DateRole, PdfDateFormatOption>>;
type DateFieldsResult = {
  transaction: PdfDateCandidateResult;
  posting: PdfDateCandidateResult;
  value: PdfDateCandidateResult;
};

export function interpretPdfBlocks(
  pages: PdfReconstructedPage[],
  blocks: PdfTransactionBlock[],
  schema: PdfTableSchema | null,
  guidance: PdfParserGuidance,
  dateFormatsByRole: DateFormatsByRole = {}
): PdfInterpretResult {
  const accountTypeConfirmed = guidance.accountType !== "auto";
  const accountType = accountTypeConfirmed
    ? guidance.accountType as PdfAccountType
    : detectAccountType(pages, guidance.regions);
  const index = createPdfPageIndex(pages);
  const balanceBehavior = detectBalanceBehavior(pages, blocks, schema, index);
  const balanceCheckpoints = detectBalanceCheckpoints(pages, schema, guidance);
  // A single amount column that marks only its credits has told us what an
  // unmarked row means. Using that is still an inference, so the rows it
  // resolves stay in review until the reader confirms them.
  const markerConvention = inferUnsignedDirectionFromMarkers(guidance, schema?.columns ?? [], index);
  const previousDates = new Map<string, DateFieldsResult>();
  const transactions = blocks.filter((block) => !block.excluded).map((block, blockIndex) => {
    const transaction = interpretBlock(
      block,
      schema,
      guidance,
      blockIndex,
      dateFormatsByRole,
      previousDates.get(block.sectionId),
      balanceBehavior,
      { accountType, accountTypeConfirmed, markerConvention },
      index
    );
    const dates = dateFieldsForTransaction(transaction);
    if (dates.transaction.value || dates.posting.value || dates.value.value) {
      previousDates.set(block.sectionId, dates);
    }
    return transaction;
  });
  // The balance column only becomes sign evidence once its polarity is known.
  // A keyword-detected account type is a guess, so directions derived from it
  // stay in review instead of being presented as reconciled facts.
  const balancePolarity = balanceBehavior === "running"
    ? detectBalancePolarity(transactions, balanceCheckpoints, accountType, accountTypeConfirmed)
    : null;
  if (balancePolarity) {
    reconcileDirectionsFromBalances(transactions, balancePolarity, balanceCheckpoints);
  }
  return {
    transactions,
    accountType,
    accountTypeConfirmed,
    balanceBehavior,
    balanceCheckpoints,
    balancePolarity,
    diagnostics: transactions.map((transaction) => diagnostic({
      stage: "interpret",
      code: "TRANSACTION_INTERPRETED",
      pageNumber: transaction.raw.pageNumber,
      sourceIds: transaction.raw.sourceIds,
      metrics: { status: transaction.status, issues: transaction.issueCodes.length },
    })),
  };
}

function interpretBlock(
  block: PdfTransactionBlock,
  schema: PdfTableSchema | null,
  guidance: PdfParserGuidance,
  sourceRowNumber: number,
  dateFormatsByRole: DateFormatsByRole,
  inheritedDates: DateFieldsResult | undefined,
  balanceBehavior: PdfBalanceBehavior,
  account: { accountType: PdfAccountType; accountTypeConfirmed: boolean; markerConvention: PdfDirection | null },
  index: PdfPageIndex
): PdfTransactionProposal {
  const rows = rowsForBlock(index, block);
  const cells = rows.flatMap((row) => row.cells);
  const columns = schema?.columns ?? [];
  const dateValues = dateFields(
    rows,
    columns,
    guidance,
    index,
    dateFormatsByRole,
    block.inheritsPreviousDate ? inheritedDates : undefined,
    block.sourceIds
  );
  const money = amountFields(
    cells,
    columns,
    guidance,
    index,
    block.sectionDirection,
    balanceBehavior,
    account
  );
  const descriptionCells = cellsForRole(rows, columns, "description", index);
  const referenceCells = cellsForRole(rows, columns, "reference", index);
  const fallbackText = rows.map((row) => row.text).join(" ");
  const description = (descriptionCells.length ? descriptionCells.map((cell) => cell.text).join(" ") : fallbackDescription(fallbackText)).trim();
  const descriptionSourceIds = (descriptionCells.length ? descriptionCells : cells).flatMap((cell) => cell.tokenIds);
  const descriptionConfidence: PdfFieldConfidence = description
    ? { status: descriptionCells.length ? "accepted" : "review", score: descriptionCells.length ? 0.95 : 0.65, reasons: descriptionCells.length ? [] : ["ROW_CONTINUATION_UNCERTAIN"], sourceIds: descriptionSourceIds }
    : { status: "rejected", score: 0, reasons: ["DESCRIPTION_MISSING"], sourceIds: descriptionSourceIds };
  const importField = guidance.importDate === "transaction"
    ? dateValues.transaction
    : guidance.importDate === "posting"
      ? dateValues.posting
      : dateValues.value;
  const requiredImportField = importField.value ? importField : requiredDate(importField.confidence.sourceIds);
  // An ordinary wrapped description is not an assumption worth reviewing. A
  // continuation only earns review when it carries its own money or date
  // token, or when the block spans a page break, because those are the cases
  // where the grouping could have swallowed a separate transaction.
  const continuationRows = rows.filter((row) => row.id !== block.rowIds[0]);
  const spansPages = new Set(rows.map((row) => row.pageNumber)).size > 1;
  // Only a continuation that could stand on its own - it carries both a date
  // and a money-shaped value - might be a transaction the grouping swallowed.
  // Reference numbers, times, and foreign-currency lines are ordinary detail.
  const uncertainContinuation = continuationRows.some((row) =>
    dateCandidates(row.text).length > 0 && looksLikeMoney(row.text)
  ) || spansPages;
  const rowBoundary: PdfFieldConfidence = {
    status: block.manuallyCreated || uncertainContinuation ? "review" : "accepted",
    score: block.manuallyCreated ? 0.7 : uncertainContinuation ? 0.82 : 0.94,
    reasons: uncertainContinuation ? ["ROW_CONTINUATION_UNCERTAIN"] : [],
    sourceIds: block.sourceIds,
  };
  // An unknown statement currency is one statement-level question, raised as a
  // detection warning. Only a row that prints a currency different from the
  // statement currency is a per-row question.
  const rowCurrencyConflict = Boolean(
    money.currency && guidance.currency && money.currency !== guidance.currency
  );
  const currencyConfidence: PdfFieldConfidence = rowCurrencyConflict
    ? { status: "review", score: 0.6, reasons: ["CURRENCY_AMBIGUOUS"], sourceIds: money.sourceIds }
    : money.currency
      ? { status: "accepted", score: 0.95, reasons: [], sourceIds: money.sourceIds }
      : guidance.currency
        ? { status: "accepted", score: 0.9, reasons: [], sourceIds: [] }
        : { status: "accepted", score: 0.7, reasons: [], sourceIds: money.sourceIds };
  const confidence = {
    rowBoundary,
    transactionDate: dateValues.transaction.confidence,
    postingDate: dateValues.posting.raw ? dateValues.posting.confidence : null,
    valueDate: dateValues.value.raw ? dateValues.value.confidence : null,
    importDate: requiredImportField.confidence,
    description: descriptionConfidence,
    reference: referenceCells.length
      ? { status: "accepted" as const, score: 0.95, reasons: [], sourceIds: referenceCells.flatMap((cell) => cell.tokenIds) }
      : null,
    accountAmount: money.amountConfidence,
    originalAmount: money.originalAmount
      ? { status: "accepted" as const, score: 0.9, reasons: [], sourceIds: money.originalAmount.sourceIds }
      : null,
    exchangeRate: money.exchangeRate
      ? { status: "accepted" as const, score: 0.9, reasons: [], sourceIds: money.exchangeRate.sourceIds }
      : null,
    fees: money.fees.map((entry) => ({ status: "accepted" as const, score: 0.9, reasons: [], sourceIds: entry.sourceIds })),
    vat: money.vat.map((entry) => ({ status: "accepted" as const, score: 0.9, reasons: [], sourceIds: entry.sourceIds })),
    direction: money.directionConfidence,
    currency: currencyConfidence,
    balance: money.balanceConfidence,
  };
  const confidenceFields = allConfidenceFields(confidence);
  const status = aggregateStatus(confidenceFields);
  const issueCodes = unique(confidenceFields.flatMap((field) => field.reasons));
  return {
    id: block.id,
    sourceRowNumber: sourceRowNumber + 1,
    sectionId: block.sectionId,
    transactionDate: dateValues.transaction.value,
    postedDate: dateValues.posting.value,
    valueDate: dateValues.value.value,
    importDate: requiredImportField.value,
    description,
    reference: referenceCells.map((cell) => cell.text).join(" ").trim() || null,
    amount: money.amount ? formatExactDecimal(money.amount.decimal, money.direction) : "",
    exactAmount: money.amount ? exactMoney(money.amount.decimal, money.currency ?? guidance.currency, money.amount.sourceIds) : null,
    originalAmount: money.originalAmount ? exactMoney(money.originalAmount.decimal, money.originalCurrency ?? money.originalAmount.currency, money.originalAmount.sourceIds) : null,
    exchangeRate: money.exchangeRate ? unsignedDecimal(money.exchangeRate.decimal) : null,
    fees: money.fees.map((entry) => exactMoney(entry.decimal, entry.currency, entry.sourceIds)),
    vat: money.vat.map((entry) => exactMoney(entry.decimal, entry.currency, entry.sourceIds)),
    direction: money.direction,
    directionEvidence: money.directionEvidence,
    balance: money.balance ? formatSignedDecimal(money.balance.decimal) : null,
    currency: money.currency ?? guidance.currency,
    confidence,
    status,
    issueCodes,
    raw: { pageNumber: block.pageNumber, lines: rows.map((row) => row.rawText), sourceIds: block.sourceIds },
  };
}

function dateFields(
  rows: PdfVisualRow[],
  columns: PdfColumn[],
  guidance: PdfParserGuidance,
  index: PdfPageIndex,
  dateFormatsByRole: DateFormatsByRole = {},
  inherited?: DateFieldsResult,
  inheritedSourceIds: string[] = []
): DateFieldsResult {
  const hasTransactionDate = columns.some((column) => column.role === "transaction-date");
  const hasPostingDate = columns.some((column) => column.role === "posting-date");
  const hasValueDate = columns.some((column) => column.role === "value-date");
  const mapped = {
    transaction: sourceForRole(rows, columns, "transaction-date", index),
    posting: sourceForRole(rows, columns, "posting-date", index),
    value: sourceForRole(rows, columns, "value-date", index),
  };
  // Candidates come from individual cells, so a value spanning the gap between
  // two cells cannot be read as a date the statement never printed.
  const allMatches = rows.flatMap((row) => row.cells.flatMap((cell) =>
    dateCandidates(cell.text).map((raw) => ({ raw, sourceIds: cell.tokenIds }))));
  if (!mapped.transaction.raw && (!hasTransactionDate || columns.length === 0) && allMatches[0]) mapped.transaction = allMatches[0];
  if (hasPostingDate && !mapped.posting.raw && allMatches[1]) mapped.posting = allMatches[1];
  const parsed = {
    transaction: mapped.transaction.raw
      ? parsePdfDateCandidate(mapped.transaction.raw, dateFormatsByRole["transaction-date"] ?? guidance.dateFormat, mapped.transaction.sourceIds, guidance.statementPeriod)
      : emptyOptionalDate(),
    posting: hasPostingDate && mapped.posting.raw
      ? parsePdfDateCandidate(mapped.posting.raw, dateFormatsByRole["posting-date"] ?? guidance.dateFormat, mapped.posting.sourceIds, guidance.statementPeriod)
      : emptyOptionalDate(),
    value: hasValueDate && mapped.value.raw
      ? parsePdfDateCandidate(mapped.value.raw, dateFormatsByRole["value-date"] ?? guidance.dateFormat, mapped.value.sourceIds, guidance.statementPeriod)
      : emptyOptionalDate(),
  };
  if (!inherited) return parsed;
  return {
    transaction: hasTransactionDate && !parsed.transaction.value
      ? inheritedDate(inherited.transaction, inheritedSourceIds)
      : parsed.transaction,
    posting: hasPostingDate && !parsed.posting.value
      ? inheritedDate(inherited.posting, inheritedSourceIds)
      : parsed.posting,
    value: hasValueDate && !parsed.value.value
      ? inheritedDate(inherited.value, inheritedSourceIds)
      : parsed.value,
  };
}

function amountFields(
  cells: PdfVisualCell[],
  columns: PdfColumn[],
  guidance: PdfParserGuidance,
  index: PdfPageIndex,
  sectionDirection: PdfDirection | undefined,
  balanceBehavior: PdfBalanceBehavior,
  account: { accountType: PdfAccountType; accountTypeConfirmed: boolean; markerConvention: PdfDirection | null }
) {
  const debit = moneyForRole(cells, columns, "debit", guidance, index);
  const credit = moneyForRole(cells, columns, "credit", guidance, index);
  const amountEntries = moneyForRole(cells, columns, "amount", guidance, index);
  const balanceEntries = moneyForRole(cells, columns, "balance", guidance, index);
  const originalEntries = moneyForRole(cells, columns, "original-amount", { ...guidance, currency: null }, index);
  const originalCurrencyText = cellsForRoleFromCells(cells, columns, "original-currency", index).map((cell) => cell.text).join(" ");
  const exchangeRates = cellsForRoleFromCells(cells, columns, "exchange-rate", index).flatMap((cell) => {
    const decimal = parseExactDecimal(cell.text, guidance.numberFormat);
    return decimal ? [{ decimal, raw: cell.text, sourceIds: cell.tokenIds, currency: null }] : [];
  });
  const fees = moneyForRole(cells, columns, "fee", guidance, index);
  const vat = moneyForRole(cells, columns, "vat", guidance, index);
  const directionText = cellsForRoleFromCells(cells, columns, "direction", index).map((cell) => cell.text).join(" ");
  const selectedDebit = debit.at(-1) ?? null;
  const selectedCredit = credit.at(-1) ?? null;
  const selectedAmount = amountEntries.at(-1) ?? null;
  let selected = selectedDebit ?? selectedCredit ?? selectedAmount;
  let direction: PdfDirection = "unknown";
  let directionEvidence: PdfDirectionEvidence = "unknown";
  let reason: PdfConfidenceReason = "DIRECTION_UNRESOLVED";
  const marker = directionMarker(selected?.raw ?? "", directionText);
  const liabilityAccount = LIABILITY_ACCOUNT_TYPES.includes(account.accountType);
  const signConventionInverted = guidance.printedSign === "issuer"
    || (guidance.printedSign === "auto" && liabilityAccount && account.accountTypeConfirmed);
  let signNeedsConfirmation = false;
  let conventionNeedsConfirmation = false;
  let directionConflict = false;
  if (selectedDebit && !selectedCredit) {
    selected = selectedDebit; direction = "debit"; directionEvidence = "debit-column"; reason = "DIRECTION_FROM_DEBIT_COLUMN";
    directionConflict = marker === "credit";
  } else if (selectedCredit && !selectedDebit) {
    selected = selectedCredit; direction = "credit"; directionEvidence = "credit-column"; reason = "DIRECTION_FROM_CREDIT_COLUMN";
    directionConflict = marker === "debit";
  } else {
    if (marker) {
      direction = marker === "debit" ? "debit" : "credit"; directionEvidence = "marker"; reason = "DIRECTION_FROM_MARKER";
      const printedNegative = Boolean(selected && printedSignOf(selected.raw) === "negative");
      const printedPositive = Boolean(selected && printedSignOf(selected.raw) === "positive");
      directionConflict = (marker === "credit" && printedNegative) || (marker === "debit" && printedPositive);
    } else if (selected && printedSignOf(selected.raw)) {
      // A deposit account prints from the account holder's side, so a minus is
      // money out. A card or loan issuer prints from its own side, where a
      // minus reduces what is owed and is money in for the Actual account.
      const printedNegative = printedSignOf(selected.raw) === "negative";
      direction = printedNegative !== signConventionInverted ? "debit" : "credit";
      directionEvidence = "signed";
      reason = "DIRECTION_FROM_SIGN";
      signNeedsConfirmation = guidance.printedSign === "auto" && liabilityAccount;
    } else if (guidance.unsignedDirection !== "review") {
      direction = guidance.unsignedDirection; directionEvidence = "explicit-policy"; reason = "DIRECTION_EXPLICIT_POLICY";
    } else if (sectionDirection && sectionDirection !== "unknown") {
      direction = sectionDirection; directionEvidence = "section"; reason = "DIRECTION_FROM_SECTION";
    } else if (account.markerConvention && selected) {
      direction = account.markerConvention;
      directionEvidence = "marker-convention";
      reason = "DIRECTION_FROM_MARKER_CONVENTION";
      conventionNeedsConfirmation = true;
    }
  }
  const sourceIds = selected?.sourceIds ?? [];
  const selectedCurrency = selected?.currency ?? guidance.currency;
  const currencyScaleMismatch = Boolean(
    selected
    && selectedCurrency
    && selected.decimal.scale > minorUnitDigits(selectedCurrency)
    && BigInt(selected.decimal.coefficient) % (BigInt(10) ** BigInt(selected.decimal.scale - minorUnitDigits(selectedCurrency))) !== BigInt(0)
  );
  // Actual's transaction boundary stores integer hundredths. Keep the source
  // value exact in the parser model, but do not let a meaningful third (or
  // later) decimal place be rounded silently during import.
  const downstreamPrecisionUnsupported = Boolean(
    selected
    && selected.decimal.scale > 2
    && BigInt(selected.decimal.coefficient) % (BigInt(10) ** BigInt(selected.decimal.scale - 2)) !== BigInt(0)
  );
  const zeroAmount = Boolean(selected && BigInt(selected.decimal.coefficient) === BigInt(0));
  const amountReasons: PdfConfidenceReason[] = selected
    ? ["AMOUNT_FROM_MAPPED_COLUMN", ...(selected.decimal.ambiguous ? ["AMOUNT_FORMAT_AMBIGUOUS" as const] : [])]
    : ["AMOUNT_MISSING"];
  if (currencyScaleMismatch) amountReasons.push("CURRENCY_MINOR_UNIT_MISMATCH");
  if (downstreamPrecisionUnsupported) amountReasons.push("ACTUAL_PRECISION_UNSUPPORTED");
  if (zeroAmount) amountReasons.push("AMOUNT_ZERO");
  if (selectedDebit && selectedCredit) amountReasons.push("AMOUNT_DEBIT_CREDIT_CONFLICT");
  const selectedRoleCandidates = selectedDebit ? debit : selectedCredit ? credit : amountEntries;
  if (selectedRoleCandidates.length > 1) amountReasons.push("AMOUNT_MULTIPLE_CANDIDATES");
  const amountRejected = currencyScaleMismatch || downstreamPrecisionUnsupported || zeroAmount || Boolean(selectedDebit && selectedCredit);
  const amountConfidence: PdfFieldConfidence = selected
    ? { status: amountRejected ? "rejected" : amountReasons.length > 1 ? "review" : "accepted", score: amountRejected ? 0 : amountReasons.length > 1 ? 0.65 : 0.95, reasons: amountReasons, sourceIds }
    : { status: "rejected", score: 0, reasons: amountReasons, sourceIds };
  const directionConfidence: PdfFieldConfidence = directionConflict
    ? { status: "rejected", score: 0, reasons: [reason, "DIRECTION_EVIDENCE_CONFLICT"], sourceIds }
    : direction === "unknown"
    ? { status: "rejected", score: 0, reasons: [reason], sourceIds }
    : signNeedsConfirmation
      ? { status: "review", score: 0.6, reasons: [reason, "SIGN_CONVENTION_UNCONFIRMED"], sourceIds }
      : conventionNeedsConfirmation
        ? { status: "review", score: 0.7, reasons: [reason], sourceIds }
        : { status: "accepted", score: directionEvidence === "explicit-policy" ? 0.9 : 0.95, reasons: [reason], sourceIds };
  const selectedBalance = balanceEntries.at(-1) ?? null;
  const balanceConfidence: PdfFieldConfidence | null = selectedBalance
    ? {
      status: "accepted",
      score: balanceBehavior === "running" ? 0.8 : 0.95,
      reasons: [],
      sourceIds: selectedBalance.sourceIds,
    }
    : null;
  return {
    amount: selected,
    originalAmount: originalEntries[0] ?? null,
    originalCurrency: currencyFrom(originalCurrencyText),
    exchangeRate: exchangeRates[0] ?? null,
    fees,
    vat,
    balance: selectedBalance,
    currency: selected?.currency ?? null,
    sourceIds,
    direction,
    directionEvidence,
    amountConfidence,
    directionConfidence,
    balanceConfidence,
  };
}

/**
 * What an unmarked amount means, read from the statement rather than assumed.
 *
 * When one amount column carries `CR` on some rows and nothing on the others,
 * and no row prints a sign, the unmarked rows are the opposite of the marker.
 * Mixed markers, printed signs, or separate money-in and money-out columns all
 * answer the question themselves, so nothing is inferred in those cases.
 */
function inferUnsignedDirectionFromMarkers(
  guidance: PdfParserGuidance,
  columns: PdfColumn[],
  index: PdfPageIndex
): PdfDirection | null {
  if (guidance.unsignedDirection !== "review") return null;
  if (columns.some((column) => column.role === "debit" || column.role === "credit")) return null;
  const amountColumn = columns.find((column) => column.role === "amount");
  if (!amountColumn) return null;
  const directionColumn = columns.find((column) => column.role === "direction");

  let credit = 0;
  let debit = 0;
  let unmarked = 0;
  const rowIds = guidance.regions
    .filter((region) => region.kind === "transactions" && region.included)
    .flatMap((region) => region.rowIds);
  for (const rowId of rowIds) {
    const row = index.rowsById.get(rowId);
    if (!row) continue;
    const pageWidth = index.widthByPage.get(row.pageNumber) ?? 1;
    const amountText = rowValuesForColumn(row, amountColumn, pageWidth).map((cell) => cell.text).join(" ");
    if (!moneyCandidates(amountText).length) continue;
    if (printedSignOf(amountText)) return null;
    const directionText = directionColumn
      ? rowValuesForColumn(row, directionColumn, pageWidth).map((cell) => cell.text).join(" ")
      : "";
    const marker = directionMarker(amountText, directionText);
    if (marker === "credit") credit += 1;
    else if (marker === "debit") debit += 1;
    else unmarked += 1;
  }
  // Only the credit-marked convention is safe to read this way. A statement
  // with one amount column marks the exceptions, and the exception it marks is
  // money in: "113.61CR" among unmarked charges. The mirror image is not a
  // convention - a lone DR on an interest line says nothing about the rest -
  // so it is left for the reader to answer.
  if (!unmarked || debit > 0 || credit === 0) return null;
  return unmarked > credit ? "debit" : null;
}

function moneyForRole(cells: PdfVisualCell[], columns: PdfColumn[], role: PdfColumnRole, guidance: PdfParserGuidance, index: PdfPageIndex) {
  return cellsForRoleFromCells(cells, columns, role, index).flatMap((cell) => moneyCandidates(cell.text).flatMap((raw) => {
    const decimal = parseExactDecimal(raw, guidance.numberFormat);
    if (!decimal) return [];
    return [{ decimal, raw, sourceIds: cell.tokenIds, currency: currencyFrom(raw) ?? guidance.currency }];
  }));
}

type BalanceStep = { transaction: PdfTransactionProposal; delta: bigint };

/**
 * Every balance movement that can be compared with one transaction amount,
 * including the opening-balance checkpoint. `delta` is the chronological
 * change in the printed balance column, regardless of account type.
 */
function balanceSteps(
  transactions: PdfTransactionProposal[],
  checkpoints: PdfBalanceCheckpoint[]
): BalanceStep[] {
  const steps: BalanceStep[] = [];
  const first = transactions[0];
  const opening = checkpoints.find((checkpoint) => checkpoint.kind === "opening");
  if (first?.balance && first.exactAmount && opening) {
    const after = scaledDecimal(first.balance);
    if (after && after.scale === opening.scale && after.scale === first.exactAmount.scale) {
      steps.push({ transaction: first, delta: after.coefficient - BigInt(opening.coefficient) });
    }
  }
  const order = chronologicalOrder(transactions);
  for (let index = 1; index < transactions.length; index += 1) {
    const previous = transactions[index - 1];
    const current = transactions[index];
    if (previous.sectionId !== current.sectionId || !previous.balance || !current.balance || !previous.importDate || !current.importDate) continue;
    const before = scaledDecimal(previous.balance);
    const after = scaledDecimal(current.balance);
    const ascending = previous.importDate === current.importDate ? order !== "descending" : previous.importDate < current.importDate;
    const transaction = ascending ? current : previous;
    if (!before || !after || !transaction.exactAmount || before.scale !== after.scale || after.scale !== transaction.exactAmount.scale) continue;
    steps.push({
      transaction,
      delta: ascending ? after.coefficient - before.coefficient : before.coefficient - after.coefficient,
    });
  }
  return steps;
}

/**
 * Decide which way the balance column moves before using it as sign evidence.
 *
 * Printed directions that already agree with the balance column are the
 * strongest signal and need no account type at all. Only when the statement
 * has no printed direction does the account type decide, and a type that was
 * merely detected from page text keeps the derived directions in review.
 */
export function detectBalancePolarity(
  transactions: PdfTransactionProposal[],
  checkpoints: PdfBalanceCheckpoint[],
  accountType: PdfAccountType,
  accountTypeConfirmed: boolean
): PdfBalancePolarity | null {
  let deposit = 0;
  let liability = 0;
  for (const { transaction, delta } of balanceSteps(transactions, checkpoints)) {
    if (transaction.direction === "unknown" || !transaction.exactAmount) continue;
    const magnitude = absolute(BigInt(transaction.exactAmount.coefficient));
    if (magnitude === BigInt(0) || absolute(delta) !== magnitude) continue;
    const accountHolderFlow = transaction.direction === "debit" ? -magnitude : magnitude;
    if (delta === accountHolderFlow) deposit += 1;
    else liability += 1;
  }
  if (deposit >= 2 && liability === 0) return { direction: "deposit", source: "evidence" };
  if (liability >= 2 && deposit === 0) return { direction: "liability", source: "evidence" };
  // Printed directions that disagree with each other cannot establish the
  // polarity, and an account type must not overrule them.
  if (deposit > 0 && liability > 0) return null;
  const typed = LIABILITY_ACCOUNT_TYPES.includes(accountType)
    ? "liability" as const
    : DEPOSIT_ACCOUNT_TYPES.includes(accountType)
      ? "deposit" as const
      : null;
  if (!typed) return null;
  return { direction: typed, source: accountTypeConfirmed ? "confirmed-type" : "detected-type" };
}

function reconcileDirectionsFromBalances(
  transactions: PdfTransactionProposal[],
  polarity: PdfBalancePolarity,
  checkpoints: PdfBalanceCheckpoint[]
) {
  const liability = polarity.direction === "liability";
  const evidence: { transaction: PdfTransactionProposal; cashFlow: bigint }[] = [];
  for (const { transaction, delta } of balanceSteps(transactions, checkpoints)) {
    if (!transaction.exactAmount) continue;
    const accountCashFlow = liability ? -delta : delta;
    const magnitude = absolute(BigInt(transaction.exactAmount.coefficient));
    if (absolute(accountCashFlow) !== magnitude) continue;
    if (transaction.direction !== "unknown") {
      const signed = transaction.direction === "debit" ? -magnitude : magnitude;
      if (signed !== accountCashFlow) return;
    }
    evidence.push({ transaction, cashFlow: accountCashFlow });
  }
  // One balance pair can be a fee, subtotal, or mis-grouped row. Require a
  // sequence before balance movement becomes sign evidence.
  if (evidence.length < 2) return;
  const derivedFromGuess = polarity.source === "detected-type";
  evidence.forEach(({ transaction, cashFlow }) => {
    if (transaction.direction !== "unknown" || !transaction.exactAmount) return;
    transaction.direction = cashFlow < BigInt(0) ? "debit" : "credit";
    transaction.directionEvidence = "balance";
    transaction.amount = formatExact(transaction.exactAmount, transaction.direction);
    transaction.confidence.direction = derivedFromGuess
      ? {
        status: "review",
        score: 0.7,
        reasons: ["DIRECTION_FROM_BALANCE", "BALANCE_RECONCILED", "ACCOUNT_TYPE_UNCONFIRMED"],
        sourceIds: transaction.confidence.accountAmount.sourceIds,
      }
      : {
        status: "accepted",
        score: 1,
        reasons: ["DIRECTION_FROM_BALANCE", "BALANCE_RECONCILED"],
        sourceIds: transaction.confidence.accountAmount.sourceIds,
      };
    transaction.confidence.balance = { status: "accepted", score: 1, reasons: ["BALANCE_RECONCILED"], sourceIds: transaction.confidence.balance?.sourceIds ?? [] };
    const fields = allConfidenceFields(transaction.confidence);
    transaction.issueCodes = unique(fields.flatMap((field) => field.reasons));
    transaction.status = aggregateStatus(fields);
  });
}

function detectBalanceCheckpoints(
  pages: PdfReconstructedPage[],
  schema: PdfTableSchema | null,
  guidance: PdfParserGuidance
): PdfBalanceCheckpoint[] {
  const balanceColumn = schema?.columns.find((column) => column.role === "balance");
  if (!balanceColumn) return [];
  const patterns: [PdfBalanceCheckpoint["kind"], RegExp][] = [
    ["opening", /\b(?:opening|previous|beginning)\s+balance\b/i],
    ["carry-forward", /\b(?:balance\s+(?:(?:brought|carried)\s+)?forward|brought\s+forward|carried\s+forward)\b/i],
    ["closing", /\b(?:closing|ending)\s+balance\b/i],
  ];
  return pages.flatMap((page) => page.rows.flatMap((row) => {
    const kind = patterns.find(([, pattern]) => pattern.test(row.text.trim()))?.[0];
    if (!kind) return [];
    const values = rowValuesForColumn(row, balanceColumn, page.width)
      .flatMap((cell) => moneyCandidates(cell.text).map((raw) => ({ raw, sourceIds: cell.tokenIds })));
    const selected = values.at(-1);
    const decimal = selected ? parseExactDecimal(selected.raw, guidance.numberFormat) : null;
    return decimal && selected ? [{
      kind,
      pageNumber: row.pageNumber,
      y: row.y,
      coefficient: decimal.coefficient.toString(),
      scale: decimal.scale,
      sourceIds: selected.sourceIds,
    }] : [];
  }));
}

function detectBalanceBehavior(
  pages: PdfReconstructedPage[],
  blocks: PdfTransactionBlock[],
  schema: PdfTableSchema | null,
  index: PdfPageIndex
): PdfBalanceBehavior {
  const column = schema?.columns.find((entry) => entry.role === "balance");
  if (!column) return "none";
  const header = column.header?.toLowerCase() ?? "";
  if (/available|spendable|withdrawable/.test(header)) return "available";
  if (/daily|periodic|end of day/.test(header)) return "periodic";
  if (/running|ledger|book|account\s+balance|^balance$/.test(header)) return "running";

  const populated = blocks.filter((block) => rowsForBlock(index, block).some((row) =>
    rowValuesForColumn(row, column, index.widthByPage.get(row.pageNumber) ?? 1)
      .some((cell) => moneyCandidates(cell.text).length > 0)
  )).length;
  const density = populated / Math.max(1, blocks.length);
  if (density >= 0.6) return "running";
  if (density > 0) return "periodic";
  return "unknown";
}

function chronologicalOrder(transactions: PdfTransactionProposal[]) {
  let ascending = 0;
  let descending = 0;
  transactions.slice(1).forEach((transaction, index) => {
    const previous = transactions[index];
    if (transaction.sectionId !== previous.sectionId || !transaction.importDate || !previous.importDate) return;
    if (transaction.importDate > previous.importDate) ascending += 1;
    if (transaction.importDate < previous.importDate) descending += 1;
  });
  return descending > ascending ? "descending" as const : "ascending" as const;
}

function absolute(value: bigint) {
  return value < BigInt(0) ? -value : value;
}

/** Read a balance string the parser itself formatted, without re-guessing grouping. */
function scaledDecimal(value: string) {
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return { coefficient: BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`), scale: (match[3] ?? "").length };
}

function sourceForRole(rows: PdfVisualRow[], columns: PdfColumn[], role: PdfColumnRole, index: PdfPageIndex) {
  const column = columns.find((entry) => entry.role === role);
  const cells = column ? rows.flatMap((row) => rowValuesForColumn(
    row,
    column,
    index.widthByPage.get(row.pageNumber) ?? 1
  )) : [];
  return { raw: cells.map((cell) => cell.text).join(" ").trim() || null, sourceIds: cells.flatMap((cell) => cell.tokenIds) };
}

function cellsForRole(rows: PdfVisualRow[], columns: PdfColumn[], role: PdfColumnRole, index: PdfPageIndex) {
  return cellsForRoleFromCells(rows.flatMap((row) => row.cells), columns, role, index);
}

function cellsForRoleFromCells(cells: PdfVisualCell[], columns: PdfColumn[], role: PdfColumnRole, index: PdfPageIndex) {
  const matchingColumns = columns.filter((entry) => entry.role === role);
  if (!matchingColumns.length) return [];
  return cells.filter((cell) => matchingColumns.some((column) => {
    if (!columnAppliesToPage(column, cell.pageNumber) || !cellBelongsToColumn(cell, column)) return false;
    const pageWidth = index.widthByPage.get(cell.pageNumber) ?? 1;
    const bounds = columnBoundsForPage(column, pageWidth);
    return overlap(cell.x, cell.x + cell.width, bounds.xStart, bounds.xEnd) >= 0.25;
  })).sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y || left.x - right.x);
}

function rowsForBlock(index: PdfPageIndex, block: PdfTransactionBlock) {
  return block.rowIds
    .flatMap((rowId) => {
      const row = index.rowsById.get(rowId);
      return row ? [row] : [];
    })
    .sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y);
}

/**
 * Used only when no description column is mapped. It removes the values the
 * row is already reporting elsewhere - validated dates and money-shaped
 * amounts - and keeps everything else, so a merchant such as "SHOP 12" is not
 * mistaken for a date and erased.
 */
function fallbackDescription(text: string) {
  const withoutDates = dateCandidates(text).reduce(
    (value, candidate) => value.split(candidate).join(" "),
    text
  );
  const withoutMoney = moneyCandidates(withoutDates)
    .filter(looksLikeMoney)
    .reduce((value, candidate) => value.split(candidate).join(" "), withoutDates);
  return withoutMoney
    .replace(/(?<!\p{L})(?:CR|DR)(?!\p{L})/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function currencyFrom(value: string) {
  const match = value.match(CURRENCY_CANDIDATE)?.[0]?.toUpperCase();
  return match && /^[A-Z]{3}$/.test(match) ? match : null;
}

function minorUnitDigits(currency: string) {
  if (["BHD", "KWD", "OMR"].includes(currency)) return 3;
  if (["JPY"].includes(currency)) return 0;
  return 2;
}

function exactMoney(decimal: ReturnType<typeof parseExactDecimal> & {}, currency: string | null, sourceIds: string[]): PdfExactMoney {
  return { coefficient: decimal.coefficient.toString(), scale: decimal.scale, currency, raw: decimal.raw, sourceIds };
}

function inheritedDate(
  previous: PdfDateCandidateResult,
  sourceIds: string[]
): PdfDateCandidateResult {
  if (!previous.value) return emptyOptionalDate();
  return {
    value: previous.value,
    raw: null,
    confidence: {
      status: "review",
      score: 0.85,
      reasons: ["DATE_INHERITED_FROM_PREVIOUS_ROW"],
      sourceIds,
    },
  };
}

function dateFieldsForTransaction(transaction: PdfTransactionProposal): DateFieldsResult {
  return {
    transaction: {
      value: transaction.transactionDate,
      raw: null,
      confidence: transaction.confidence.transactionDate,
    },
    posting: {
      value: transaction.postedDate,
      raw: null,
      confidence: transaction.confidence.postingDate ?? emptyOptionalDate().confidence,
    },
    value: {
      value: transaction.valueDate,
      raw: null,
      confidence: transaction.confidence.valueDate ?? emptyOptionalDate().confidence,
    },
  };
}

function directionMarker(amountText: string, directionText: string): PdfDirection | null {
  const amountMarker = amountText.match(/(?<!\p{L})(CR|DR)(?!\p{L})/iu)?.[1]?.toUpperCase();
  if (amountMarker) return amountMarker === "DR" ? "debit" : "credit";
  const normalized = directionText.trim().toUpperCase();
  if (["DR", "D", "DEBIT"].includes(normalized)) return "debit";
  if (["CR", "C", "CREDIT"].includes(normalized)) return "credit";
  return null;
}

function emptyOptionalDate(): { value: null; raw: null; confidence: PdfFieldConfidence } {
  return { value: null, raw: null, confidence: { status: "accepted" as const, score: 1, reasons: [], sourceIds: [] } };
}

function requiredDate(sourceIds: string[]): { value: null; raw: null; confidence: PdfFieldConfidence } {
  return {
    value: null,
    raw: null,
    confidence: { status: "rejected", score: 0, reasons: ["DATE_INVALID"], sourceIds },
  };
}

function aggregateStatus(fields: (PdfFieldConfidence | null)[]) {
  if (fields.some((field) => field?.status === "rejected")) return "rejected" as const;
  if (fields.some((field) => field?.status === "review")) return "review" as const;
  return "accepted" as const;
}

function allConfidenceFields(confidence: PdfTransactionProposal["confidence"]): PdfFieldConfidence[] {
  return [
    confidence.rowBoundary,
    confidence.transactionDate,
    ...(confidence.postingDate ? [confidence.postingDate] : []),
    ...(confidence.valueDate ? [confidence.valueDate] : []),
    confidence.importDate,
    confidence.description,
    ...(confidence.reference ? [confidence.reference] : []),
    confidence.accountAmount,
    ...(confidence.originalAmount ? [confidence.originalAmount] : []),
    ...(confidence.exchangeRate ? [confidence.exchangeRate] : []),
    ...confidence.fees,
    ...confidence.vat,
    confidence.direction,
    confidence.currency,
    ...(confidence.balance ? [confidence.balance] : []),
  ];
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function overlap(startA: number, endA: number, startB: number, endB: number) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB)) / Math.max(1, Math.min(endA - startA, endB - startB));
}

function formatExact(value: PdfExactMoney, direction: PdfDirection) {
  return formatExactDecimal({ coefficient: BigInt(value.coefficient), scale: value.scale, raw: value.raw, ambiguous: false }, direction);
}

function unsignedDecimal(value: ReturnType<typeof parseExactDecimal> & {}) {
  const coefficient = value.coefficient < BigInt(0) ? -value.coefficient : value.coefficient;
  return formatExactDecimal({ ...value, coefficient }, "credit");
}

function formatSignedDecimal(value: ReturnType<typeof parseExactDecimal> & {}) {
  const magnitude = value.coefficient < BigInt(0) ? -value.coefficient : value.coefficient;
  const formatted = formatExactDecimal({ ...value, coefficient: magnitude }, "credit");
  return `${value.coefficient < BigInt(0) ? "-" : ""}${formatted}`;
}

/**
 * Account type is read from the statement's own heading, never from its
 * transactions: a checking statement that pays a credit card or a mortgage
 * must not be classified by those descriptions. Anything ambiguous stays
 * `unknown`, because this value decides how balance movement is signed.
 */
function detectAccountType(pages: PdfReconstructedPage[], regions: PdfRegion[]): PdfAccountType {
  const firstPage = pages[0];
  if (!firstPage) return "unknown";
  const transactionRowIds = new Set(regions
    .filter((region) => region.kind === "transactions" && region.included && region.pageNumber === firstPage.pageNumber)
    .flatMap((region) => region.rowIds));
  const text = firstPage.rows
    .filter((row) => !transactionRowIds.has(row.id))
    .map((row) => row.text)
    .join(" ")
    .toLowerCase();
  const candidates: [PdfAccountType, RegExp][] = [
    ["investment", /investment statement|securities|portfolio|holdings/],
    ["loan", /mortgage|loan statement|principal balance|amortization/],
    ["prepaid", /prepaid card|wallet statement|stored value/],
    ["credit-card", /credit card|(?<!prepaid |debit )card statement|minimum payment|credit limit/],
    ["multi-currency", /multi.?currency|foreign currency account/],
    ["business-cash", /business (?:checking|current|cash) account/],
    ["savings", /savings account|annual percentage yield|\bapy\b/],
    ["checking", /checking account|current account|deposits and withdrawals/],
  ];
  const matches = candidates.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
  if (!matches.length) return "unknown";
  // Overlapping headings such as "business checking account" are the same kind
  // of account read at two levels of detail, and the most specific candidate
  // wins. Headings that disagree about whether the account is an asset or a
  // liability are genuinely ambiguous, and guessing one would flip every sign
  // derived from the balance column.
  const groups = new Set(matches.map(balanceGroupFor));
  return groups.size === 1 ? matches[0] : "unknown";
}

function balanceGroupFor(accountType: PdfAccountType) {
  if (LIABILITY_ACCOUNT_TYPES.includes(accountType)) return "liability";
  if (DEPOSIT_ACCOUNT_TYPES.includes(accountType)) return "deposit";
  return "other";
}
