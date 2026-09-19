import { rowValuesForColumn } from "./blocks";
import { columnAppliesToPage, columnBoundsForPage } from "./columns";
import { CURRENCY_CANDIDATE, DATE_CANDIDATE, dateCandidates, formatExactDecimal, moneyCandidates, parseExactDecimal } from "./candidates";
import { parsePdfDateCandidate, type PdfDateCandidateResult } from "./dates";
import { diagnostic } from "./diagnostics";
import type {
  PdfAccountType,
  PdfBalanceBehavior,
  PdfBalanceCheckpoint,
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
  PdfTableSchema,
  PdfTransactionBlock,
  PdfTransactionProposal,
  PdfVisualCell,
  PdfVisualRow,
} from "./model";

export type PdfInterpretResult = {
  transactions: PdfTransactionProposal[];
  accountType: PdfAccountType;
  balanceBehavior: PdfBalanceBehavior;
  balanceCheckpoints: PdfBalanceCheckpoint[];
  diagnostics: PdfDiagnosticEvent[];
};

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
  const accountType = guidance.accountType === "auto" ? detectAccountType(pages) : guidance.accountType;
  const balanceBehavior = detectBalanceBehavior(pages, blocks, schema);
  const balanceCheckpoints = detectBalanceCheckpoints(pages, schema, guidance);
  const previousDates = new Map<string, DateFieldsResult>();
  const transactions = blocks.filter((block) => !block.excluded).map((block, index) => {
    const transaction = interpretBlock(
      pages,
      block,
      schema,
      guidance,
      index,
      dateFormatsByRole,
      previousDates.get(block.sectionId),
      balanceBehavior
    );
    const dates = dateFieldsForTransaction(transaction);
    if (dates.transaction.value || dates.posting.value || dates.value.value) {
      previousDates.set(block.sectionId, dates);
    }
    return transaction;
  });
  if (balanceBehavior === "running") {
    reconcileDirectionsFromBalances(transactions, accountType, balanceCheckpoints);
  }
  return {
    transactions,
    accountType,
    balanceBehavior,
    balanceCheckpoints,
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
  pages: PdfReconstructedPage[],
  block: PdfTransactionBlock,
  schema: PdfTableSchema | null,
  guidance: PdfParserGuidance,
  index: number,
  dateFormatsByRole: DateFormatsByRole,
  inheritedDates: DateFieldsResult | undefined,
  balanceBehavior: PdfBalanceBehavior
): PdfTransactionProposal {
  const rows = rowsForBlock(pages, block);
  const cells = rows.flatMap((row) => row.cells);
  const columns = schema?.columns ?? [];
  const dateValues = dateFields(
    rows,
    columns,
    guidance,
    pages,
    dateFormatsByRole,
    block.inheritsPreviousDate ? inheritedDates : undefined,
    block.sourceIds
  );
  const money = amountFields(
    cells,
    columns,
    guidance,
    pages,
    block.sectionDirection,
    balanceBehavior
  );
  const descriptionCells = cellsForRole(rows, columns, "description", pages);
  const referenceCells = cellsForRole(rows, columns, "reference", pages);
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
  const rowBoundary: PdfFieldConfidence = {
    status: block.manuallyCreated || block.rowIds.length > 1 ? "review" : "accepted",
    score: block.manuallyCreated ? 0.7 : block.rowIds.length > 1 ? 0.82 : 0.96,
    reasons: block.rowIds.length > 1 ? ["ROW_CONTINUATION_UNCERTAIN"] : [],
    sourceIds: block.sourceIds,
  };
  const currencyConfidence: PdfFieldConfidence = money.currency
    ? { status: "accepted", score: 0.95, reasons: [], sourceIds: money.sourceIds }
    : guidance.currency
      ? { status: "accepted", score: 0.9, reasons: [], sourceIds: [] }
      : { status: "review", score: 0.5, reasons: ["CURRENCY_AMBIGUOUS"], sourceIds: money.sourceIds };
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
    sourceRowNumber: index + 1,
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
  pages: PdfReconstructedPage[],
  dateFormatsByRole: DateFormatsByRole = {},
  inherited?: DateFieldsResult,
  inheritedSourceIds: string[] = []
): DateFieldsResult {
  const hasTransactionDate = columns.some((column) => column.role === "transaction-date");
  const hasPostingDate = columns.some((column) => column.role === "posting-date");
  const hasValueDate = columns.some((column) => column.role === "value-date");
  const mapped = {
    transaction: sourceForRole(rows, columns, "transaction-date", pages),
    posting: sourceForRole(rows, columns, "posting-date", pages),
    value: sourceForRole(rows, columns, "value-date", pages),
  };
  const allMatches = rows.flatMap((row) => dateCandidates(row.text)
    .map((raw) => ({ raw, sourceIds: row.cells.flatMap((cell) => cell.tokenIds) })));
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
  pages: PdfReconstructedPage[],
  sectionDirection?: PdfDirection,
  balanceBehavior: PdfBalanceBehavior = "none"
) {
  const debit = moneyForRole(cells, columns, "debit", guidance, pages);
  const credit = moneyForRole(cells, columns, "credit", guidance, pages);
  const amountEntries = moneyForRole(cells, columns, "amount", guidance, pages);
  const balanceEntries = moneyForRole(cells, columns, "balance", guidance, pages);
  const originalEntries = moneyForRole(cells, columns, "original-amount", { ...guidance, currency: null }, pages);
  const originalCurrencyText = cellsForRoleFromCells(cells, columns, "original-currency", pages).map((cell) => cell.text).join(" ");
  const exchangeRates = cellsForRoleFromCells(cells, columns, "exchange-rate", pages).flatMap((cell) => {
    const decimal = parseExactDecimal(cell.text, guidance.numberFormat);
    return decimal ? [{ decimal, raw: cell.text, sourceIds: cell.tokenIds, currency: null }] : [];
  });
  const fees = moneyForRole(cells, columns, "fee", guidance, pages);
  const vat = moneyForRole(cells, columns, "vat", guidance, pages);
  const directionText = cellsForRoleFromCells(cells, columns, "direction", pages).map((cell) => cell.text).join(" ");
  const selectedDebit = debit.at(-1) ?? null;
  const selectedCredit = credit.at(-1) ?? null;
  const selectedAmount = amountEntries.at(-1) ?? null;
  let selected = selectedDebit ?? selectedCredit ?? selectedAmount;
  let direction: PdfDirection = "unknown";
  let directionEvidence: PdfDirectionEvidence = "unknown";
  let reason: PdfConfidenceReason = "DIRECTION_UNRESOLVED";
  const marker = directionMarker(selected?.raw ?? "", directionText);
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
      const printedNegative = Boolean(selected && /^\s*-|^\s*\(/.test(selected.raw));
      const printedPositive = Boolean(selected && /^\s*\+/.test(selected.raw));
      directionConflict = (marker === "credit" && printedNegative) || (marker === "debit" && printedPositive);
    } else if (selected && /^[\s(]*[-+]/.test(selected.raw)) {
      direction = /^\s*-|^\s*\(/.test(selected.raw) ? "debit" : "credit"; directionEvidence = "signed"; reason = "DIRECTION_FROM_SIGN";
    } else if (guidance.unsignedDirection !== "review") {
      direction = guidance.unsignedDirection; directionEvidence = "explicit-policy"; reason = "DIRECTION_EXPLICIT_POLICY";
    } else if (sectionDirection && sectionDirection !== "unknown") {
      direction = sectionDirection; directionEvidence = "section"; reason = "DIRECTION_FROM_SECTION";
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

function moneyForRole(cells: PdfVisualCell[], columns: PdfColumn[], role: PdfColumnRole, guidance: PdfParserGuidance, pages: PdfReconstructedPage[]) {
  return cellsForRoleFromCells(cells, columns, role, pages).flatMap((cell) => moneyCandidates(cell.text).flatMap((raw) => {
    const decimal = parseExactDecimal(raw, guidance.numberFormat);
    if (!decimal) return [];
    return [{ decimal, raw, sourceIds: cell.tokenIds, currency: currencyFrom(raw) ?? guidance.currency }];
  }));
}

function reconcileDirectionsFromBalances(
  transactions: PdfTransactionProposal[],
  accountType: PdfAccountType,
  checkpoints: PdfBalanceCheckpoint[]
) {
  const liability = accountType === "credit-card" || accountType === "loan";
  const deposit = ["checking", "savings", "prepaid", "multi-currency", "business-cash"].includes(accountType);
  if (!liability && !deposit) return;
  const evidence: { transaction: PdfTransactionProposal; cashFlow: bigint }[] = [];
  const first = transactions[0];
  const opening = checkpoints.find((checkpoint) => checkpoint.kind === "opening");
  if (first?.balance && first.exactAmount && opening) {
    const after = parseExactDecimal(first.balance, "auto");
    if (after && after.scale === opening.scale && after.scale === first.exactAmount.scale) {
      const delta = after.coefficient - BigInt(opening.coefficient);
      const cashFlow = liability ? -delta : delta;
      if (absolute(cashFlow) === absolute(BigInt(first.exactAmount.coefficient))) {
        evidence.push({ transaction: first, cashFlow });
      }
    }
  }
  const order = chronologicalOrder(transactions);
  for (let index = 1; index < transactions.length; index += 1) {
    const previous = transactions[index - 1];
    const current = transactions[index];
    if (previous.sectionId !== current.sectionId || !previous.balance || !current.balance || !previous.importDate || !current.importDate) continue;
    const before = parseExactDecimal(previous.balance, "auto");
    const after = parseExactDecimal(current.balance, "auto");
    const ascending = previous.importDate === current.importDate ? order !== "descending" : previous.importDate < current.importDate;
    const transaction = ascending ? current : previous;
    if (!before || !after || !transaction.exactAmount || before.scale !== after.scale || after.scale !== transaction.exactAmount.scale) continue;
    const chronologicalDelta = ascending
      ? after.coefficient - before.coefficient
      : before.coefficient - after.coefficient;
    const accountCashFlow = liability ? -chronologicalDelta : chronologicalDelta;
    if (absolute(accountCashFlow) !== absolute(BigInt(transaction.exactAmount.coefficient))) continue;
    if (transaction.direction !== "unknown") {
      const signed = transaction.direction === "debit"
        ? -absolute(BigInt(transaction.exactAmount.coefficient))
        : absolute(BigInt(transaction.exactAmount.coefficient));
      if (signed !== accountCashFlow) return;
    }
    evidence.push({ transaction, cashFlow: accountCashFlow });
  }
  // One balance pair can be a fee, subtotal, or mis-grouped row. Require a
  // sequence before balance movement becomes sign evidence.
  if (evidence.length < 2) return;
  evidence.forEach(({ transaction, cashFlow }) => {
    if (transaction.direction !== "unknown" || !transaction.exactAmount) return;
    transaction.direction = cashFlow < BigInt(0) ? "debit" : "credit";
    transaction.directionEvidence = "balance";
    transaction.amount = formatExact(transaction.exactAmount, transaction.direction);
    transaction.confidence.direction = { status: "accepted", score: 1, reasons: ["DIRECTION_FROM_BALANCE", "BALANCE_RECONCILED"], sourceIds: transaction.confidence.accountAmount.sourceIds };
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
  schema: PdfTableSchema | null
): PdfBalanceBehavior {
  const column = schema?.columns.find((entry) => entry.role === "balance");
  if (!column) return "none";
  const header = column.header?.toLowerCase() ?? "";
  if (/available|spendable|withdrawable/.test(header)) return "available";
  if (/daily|periodic|end of day/.test(header)) return "periodic";
  if (/running|ledger|book|account\s+balance|^balance$/.test(header)) return "running";

  const populated = blocks.filter((block) => rowsForBlock(pages, block).some((row) =>
    rowValuesForColumn(
      row,
      column,
      pages.find((page) => page.pageNumber === row.pageNumber)?.width ?? 1
    ).some((cell) => moneyCandidates(cell.text).length > 0)
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

function sourceForRole(rows: PdfVisualRow[], columns: PdfColumn[], role: PdfColumnRole, pages: PdfReconstructedPage[]) {
  const column = columns.find((entry) => entry.role === role);
  const cells = column ? rows.flatMap((row) => rowValuesForColumn(
    row,
    column,
    pages.find((page) => page.pageNumber === row.pageNumber)?.width ?? 1
  )) : [];
  return { raw: cells.map((cell) => cell.text).join(" ").trim() || null, sourceIds: cells.flatMap((cell) => cell.tokenIds) };
}

function cellsForRole(rows: PdfVisualRow[], columns: PdfColumn[], role: PdfColumnRole, pages: PdfReconstructedPage[]) {
  return cellsForRoleFromCells(rows.flatMap((row) => row.cells), columns, role, pages);
}

function cellsForRoleFromCells(cells: PdfVisualCell[], columns: PdfColumn[], role: PdfColumnRole, pages: PdfReconstructedPage[]) {
  const matchingColumns = columns.filter((entry) => entry.role === role);
  if (!matchingColumns.length) return [];
  return cells.filter((cell) => matchingColumns.some((column) => {
    if (!columnAppliesToPage(column, cell.pageNumber)) return false;
    const pageWidth = pages.find((page) => page.pageNumber === cell.pageNumber)?.width ?? 1;
    const bounds = columnBoundsForPage(column, pageWidth);
    return overlap(cell.x, cell.x + cell.width, bounds.xStart, bounds.xEnd) >= 0.25;
  })).sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y || left.x - right.x);
}

function rowsForBlock(pages: PdfReconstructedPage[], block: PdfTransactionBlock) {
  const ids = new Set(block.rowIds);
  return pages.flatMap((page) => page.rows.filter((row) => ids.has(row.id)));
}

function fallbackDescription(text: string) {
  return text
    .replace(new RegExp(DATE_CANDIDATE.source, "giu"), " ")
    .replace(/(?:\(\s*)?[+-]?\s*(?:(?:AED|SAR|USD|EUR|GBP|KWD|BHD|QAR|OMR|INR|JPY|CHF|CAD|AUD|CNY|HKD|SGD|ZAR|[$£€¥₹])\s*)?\d[\d\s,'’.,]*(?:\s*(?:CR|DR))?\s*\)?/giu, " ")
    .replace(/\b(?:CR|DR)\b/gi, " ")
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

function detectAccountType(pages: PdfReconstructedPage[]): PdfAccountType {
  const text = pages.flatMap((page) => page.rows.slice(0, 25).map((row) => row.text)).join(" ").toLowerCase();
  const candidates: [PdfAccountType, RegExp][] = [
    ["investment", /investment statement|securities|portfolio|holdings/],
    ["loan", /mortgage|loan statement|principal balance|amortization/],
    ["prepaid", /prepaid card|wallet statement|stored value/],
    ["credit-card", /credit card|card statement|minimum payment|credit limit/],
    ["multi-currency", /multi.?currency|foreign currency account/],
    ["business-cash", /business (?:checking|current|cash) account/],
    ["savings", /savings account|annual percentage yield|\bapy\b/],
    ["checking", /checking account|current account|deposits and withdrawals/],
  ];
  return candidates.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
}
