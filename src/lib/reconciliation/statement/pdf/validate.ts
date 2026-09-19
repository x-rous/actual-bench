import { diagnostic } from "./diagnostics";
import { parseExactDecimal } from "./candidates";
import type {
  PdfAccountType,
  PdfBalanceBehavior,
  PdfBalanceCheckpoint,
  PdfConfidenceReason,
  PdfDiagnosticEvent,
  PdfParserGuidance,
  PdfReconstructedPage,
  PdfRegion,
  PdfTransactionProposal,
} from "./model";

export type PdfValidationResult = {
  transactions: PdfTransactionProposal[];
  diagnostics: PdfDiagnosticEvent[];
};

export function validatePdfTransactions(
  transactions: PdfTransactionProposal[],
  guidance: PdfParserGuidance,
  context?: {
    pages: PdfReconstructedPage[];
    regions: PdfRegion[];
    accountType: PdfAccountType;
    balanceBehavior: PdfBalanceBehavior;
    balanceCheckpoints: PdfBalanceCheckpoint[];
  }
): PdfValidationResult {
  validatePeriod(transactions, guidance.statementPeriod);
  validateImportPrecision(transactions);
  if (context?.balanceBehavior === "running") {
    validateBalanceSequences(transactions, context.accountType, context.balanceCheckpoints);
  }
  validateDuplicates(transactions);
  validateStatementSummary(transactions, context?.pages ?? [], context?.regions ?? []);
  validateCrossPageSequence(transactions);
  if (context?.accountType === "loan" || context?.accountType === "investment") {
    transactions.forEach((transaction) => addReason(transaction.confidence.rowBoundary, "ACCOUNT_TYPE_SPECIALIZED", "review", 0.7));
  }
  transactions.forEach(recalculateStatus);
  return {
    transactions,
    diagnostics: transactions.map((transaction) => diagnostic({
      stage: "validate",
      code: "TRANSACTION_VALIDATED",
      pageNumber: transaction.raw.pageNumber,
      sourceIds: transaction.raw.sourceIds,
      metrics: { status: transaction.status, reasons: transaction.issueCodes.length },
    })),
  };
}

function validateImportPrecision(transactions: PdfTransactionProposal[]) {
  transactions.forEach((transaction) => {
    const amount = transaction.exactAmount;
    if (!amount) return;
    const coefficient = BigInt(amount.coefficient);
    if (coefficient === BigInt(0)) {
      addReason(transaction.confidence.accountAmount, "AMOUNT_ZERO", "rejected", 0);
    }
    if (hasMeaningfulPrecisionBeyond(amount, 2)) {
      addReason(transaction.confidence.accountAmount, "ACTUAL_PRECISION_UNSUPPORTED", "rejected", 0);
    }
    const currencyDigits = currencyMinorUnitDigits(amount.currency);
    if (currencyDigits !== null && hasMeaningfulPrecisionBeyond(amount, currencyDigits)) {
      addReason(transaction.confidence.accountAmount, "CURRENCY_MINOR_UNIT_MISMATCH", "rejected", 0);
    }
  });
}

function hasMeaningfulPrecisionBeyond(
  amount: { coefficient: string; scale: number },
  targetScale: number
) {
  if (amount.scale <= targetScale) return false;
  const divisor = BigInt(10) ** BigInt(amount.scale - targetScale);
  return BigInt(amount.coefficient) % divisor !== BigInt(0);
}

function currencyMinorUnitDigits(currency: string | null) {
  if (!currency) return null;
  if (["BHD", "KWD", "OMR"].includes(currency)) return 3;
  if (currency === "JPY") return 0;
  return 2;
}

function validateStatementSummary(
  transactions: PdfTransactionProposal[],
  pages: PdfReconstructedPage[],
  regions: PdfRegion[]
) {
  const summaryRows = regions.filter((region) => region.kind === "summary").flatMap((region) => {
    const ids = new Set(region.rowIds);
    return pages.find((page) => page.pageNumber === region.pageNumber)?.rows.filter((row) => ids.has(row.id)) ?? [];
  });
  const expectedDebit = summaryAmount(summaryRows.map((row) => row.text), /total\s+(?:debits?|withdrawals?|money out)/i);
  const expectedCredit = summaryAmount(summaryRows.map((row) => row.text), /total\s+(?:credits?|deposits?|money in)/i);
  if (!expectedDebit && !expectedCredit) return;
  const actualDebit = expectedDebit ? sumAtScale(transactions, "debit", expectedDebit.scale) : null;
  const actualCredit = expectedCredit ? sumAtScale(transactions, "credit", expectedCredit.scale) : null;
  const mismatch = (expectedDebit && actualDebit !== null && abs(expectedDebit.coefficient) !== actualDebit)
    || (expectedCredit && actualCredit !== null && abs(expectedCredit.coefficient) !== actualCredit);
  if (mismatch) transactions.forEach((transaction) => addReason(transaction.confidence.accountAmount, "STATEMENT_SUMMARY_MISMATCH", "review", 0.4));
}

function sumAtScale(
  transactions: PdfTransactionProposal[],
  direction: "debit" | "credit",
  scale: number
) {
  return transactions.reduce<bigint | null>((total, transaction) => {
    if (!transaction.exactAmount || transaction.status === "rejected") return total;
    if (total === null || transaction.direction !== direction) return total;
    const coefficient = rescaleExact(
      BigInt(transaction.exactAmount.coefficient),
      transaction.exactAmount.scale,
      scale
    );
    return coefficient === null ? null : total + abs(coefficient);
  }, BigInt(0));
}

function rescaleExact(coefficient: bigint, fromScale: number, toScale: number) {
  if (fromScale === toScale) return coefficient;
  if (fromScale < toScale) return coefficient * (BigInt(10) ** BigInt(toScale - fromScale));
  const divisor = BigInt(10) ** BigInt(fromScale - toScale);
  return coefficient % divisor === BigInt(0) ? coefficient / divisor : null;
}

function validateCrossPageSequence(transactions: PdfTransactionProposal[]) {
  const bySection = new Map<string, PdfTransactionProposal[]>();
  transactions.forEach((transaction) => {
    const list = bySection.get(transaction.sectionId) ?? [];
    list.push(transaction);
    bySection.set(transaction.sectionId, list);
  });
  bySection.forEach((rows) => {
    const directions = rows.slice(1).flatMap((row, index) => {
      const previous = rows[index];
      if (!row.importDate || !previous.importDate || row.importDate === previous.importDate) return [];
      return [{ sign: row.importDate > previous.importDate ? 1 : -1, row, crossesPage: row.raw.pageNumber !== previous.raw.pageNumber }];
    });
    const positive = directions.filter((entry) => entry.sign > 0).length;
    const negative = directions.filter((entry) => entry.sign < 0).length;
    if (!positive || !negative) return;
    const expected = positive >= negative ? 1 : -1;
    directions.filter((entry) => entry.crossesPage && entry.sign !== expected).forEach((entry) =>
      addReason(entry.row.confidence.importDate, "CROSS_PAGE_SEQUENCE_CHANGED", "review", 0.55)
    );
  });
}

function summaryAmount(lines: string[], label: RegExp) {
  const line = lines.find((value) => label.test(value));
  if (!line) return null;
  const suffix = line.slice(line.search(label)).replace(label, "");
  return parseExactDecimal(suffix, "auto");
}

function validatePeriod(
  transactions: PdfTransactionProposal[],
  period: PdfParserGuidance["statementPeriod"]
) {
  if (!period.start && !period.end) return;
  transactions.forEach((transaction) => {
    const date = transaction.importDate;
    if (!date) return;
    if ((period.start && date < period.start) || (period.end && date > period.end)) {
      addReason(transaction.confidence.importDate, "DATE_OUTSIDE_STATEMENT_PERIOD", "review", 0.45);
    }
  });
}

function validateBalanceSequences(
  transactions: PdfTransactionProposal[],
  accountType: PdfAccountType,
  checkpoints: PdfBalanceCheckpoint[]
) {
  const liability = accountType === "credit-card" || accountType === "loan";
  const deposit = ["checking", "savings", "prepaid", "multi-currency", "business-cash"].includes(accountType);
  if (!liability && !deposit) return;
  const opening = checkpoints.find((checkpoint) => checkpoint.kind === "opening");
  const first = transactions[0];
  if (opening && first?.balance && first.exactAmount) {
    validateBalanceStep(
      first,
      { coefficient: BigInt(opening.coefficient), scale: opening.scale },
      scaled(first.balance),
      liability
    );
  }
  const order = chronologicalOrder(transactions);
  for (let index = 1; index < transactions.length; index += 1) {
    const previous = transactions[index - 1];
    const current = transactions[index];
    if (previous.sectionId !== current.sectionId || !previous.balance || !current.balance || !previous.importDate || !current.importDate) continue;
    const before = scaled(previous.balance);
    const after = scaled(current.balance);
    const ascending = previous.importDate === current.importDate ? order !== "descending" : previous.importDate < current.importDate;
    const transaction = ascending ? current : previous;
    if (!transaction.exactAmount || !before || !after || before.scale !== after.scale || after.scale !== transaction.exactAmount.scale) continue;
    const chronologicalDelta = ascending
      ? after.coefficient - before.coefficient
      : before.coefficient - after.coefficient;
    validateBalanceDelta(transaction, chronologicalDelta, liability);
  }
  validateBalanceCheckpoints(transactions, checkpoints);
}

function validateBalanceCheckpoints(
  transactions: PdfTransactionProposal[],
  checkpoints: PdfBalanceCheckpoint[]
) {
  const comparisons = checkpoints.flatMap((checkpoint) => {
    if (checkpoint.kind === "opening") return [];
    const transaction = checkpoint.kind === "closing"
      ? transactions.at(-1)
      : [...transactions].reverse().find((candidate) => candidate.raw.pageNumber < checkpoint.pageNumber);
    return transaction?.balance && transaction.confidence.balance ? [{ checkpoint, transaction }] : [];
  });
  comparisons.forEach(({ checkpoint, transaction }) => {
    const balance = scaled(transaction.balance!);
    if (!balance || balance.scale !== checkpoint.scale) return;
    if (balance.coefficient === BigInt(checkpoint.coefficient)) {
      if (!transaction.confidence.balance!.reasons.includes("BALANCE_RECONCILED")) {
        transaction.confidence.balance!.reasons.push("BALANCE_RECONCILED");
      }
      if (!transaction.confidence.balance!.reasons.includes("BALANCE_MISMATCH")) {
        transaction.confidence.balance!.status = "accepted";
        transaction.confidence.balance!.score = 1;
      }
    } else {
      addReason(transaction.confidence.balance!, "BALANCE_MISMATCH", "review", 0.3);
    }
  });
}

function validateBalanceStep(
  transaction: PdfTransactionProposal,
  before: { coefficient: bigint; scale: number },
  after: { coefficient: bigint; scale: number } | null,
  liability: boolean
) {
  if (!after || !transaction.exactAmount || before.scale !== after.scale || after.scale !== transaction.exactAmount.scale) return;
  validateBalanceDelta(transaction, after.coefficient - before.coefficient, liability);
}

function validateBalanceDelta(
  transaction: PdfTransactionProposal,
  chronologicalDelta: bigint,
  liability: boolean
) {
  if (!transaction.exactAmount) return;
  const signedCashFlow = transaction.direction === "debit"
    ? -abs(BigInt(transaction.exactAmount.coefficient))
    : transaction.direction === "credit"
      ? abs(BigInt(transaction.exactAmount.coefficient))
      : null;
  if (signedCashFlow === null) return;
  const expectedDelta = liability ? -signedCashFlow : signedCashFlow;
  if (chronologicalDelta === expectedDelta) {
    if (transaction.confidence.balance) {
      transaction.confidence.balance.status = "accepted";
      transaction.confidence.balance.score = 1;
      if (!transaction.confidence.balance.reasons.includes("BALANCE_RECONCILED")) {
        transaction.confidence.balance.reasons.push("BALANCE_RECONCILED");
      }
    }
  } else if (transaction.confidence.balance) {
    addReason(transaction.confidence.balance, "BALANCE_MISMATCH", "review", 0.3);
  }
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

function validateDuplicates(transactions: PdfTransactionProposal[]) {
  const groups = new Map<string, PdfTransactionProposal[]>();
  transactions.forEach((transaction) => {
    if (!transaction.importDate || !transaction.amount || !transaction.description) return;
    const key = `${transaction.importDate}|${transaction.amount}|${transaction.currency ?? ""}|${transaction.description.toLowerCase().replace(/\s+/g, " ")}`;
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  });
  groups.forEach((group) => {
    if (group.length < 2) return;
    group.forEach((transaction) => addReason(transaction.confidence.rowBoundary, "POSSIBLE_DUPLICATE", "review", 0.7));
  });
}

function recalculateStatus(transaction: PdfTransactionProposal) {
  const fields = confidenceFields(transaction);
  transaction.status = fields.some((field) => field.status === "rejected")
    ? "rejected"
    : fields.some((field) => field.status === "review")
      ? "review"
      : "accepted";
  transaction.issueCodes = [...new Set(fields.flatMap((field) => field.reasons))];
}

function confidenceFields(transaction: PdfTransactionProposal) {
  const confidence = transaction.confidence;
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

function addReason(
  field: { status: "accepted" | "review" | "rejected"; score: number; reasons: PdfConfidenceReason[] },
  reason: PdfConfidenceReason,
  status: "accepted" | "review" | "rejected",
  score: number
) {
  if (!field.reasons.includes(reason)) field.reasons.push(reason);
  if (rank(status) > rank(field.status)) field.status = status;
  field.score = Math.min(field.score, score);
}

function rank(status: "accepted" | "review" | "rejected") {
  return status === "rejected" ? 2 : status === "review" ? 1 : 0;
}

function scaled(value: string) {
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return { coefficient: BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`), scale: (match[3] ?? "").length };
}

function abs(value: bigint) {
  return value < BigInt(0) ? -value : value;
}
