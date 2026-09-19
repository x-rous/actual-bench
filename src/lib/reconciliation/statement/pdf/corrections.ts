import type {
  PdfCorrectionScope,
  PdfDirection,
  PdfParserGuidance,
  PdfTransactionBlock,
  PdfTransactionProposal,
} from "./model";
import { parseExactDecimal } from "./candidates";

export type PdfCorrection = {
  id: string;
  scope: PdfCorrectionScope;
  createdAt: string;
} & (
  | { kind: "set-guidance"; patch: Partial<PdfParserGuidance> }
  | { kind: "ignore-block" | "restore-block"; blockId: string }
  | { kind: "merge-blocks"; blockIds: string[] }
  | { kind: "split-block"; blockId: string; beforeRowId: string }
  | { kind: "mark-row"; rowId: string; pageNumber: number }
  | { kind: "accept-transaction"; transactionIds: string[] }
  | { kind: "set-field"; transactionIds: string[]; field: "transactionDate" | "postedDate" | "valueDate" | "importDate" | "description" | "reference" | "amount" | "currency"; value: string | null }
  | { kind: "set-direction"; transactionIds: string[]; direction: Exclude<PdfDirection, "unknown"> }
);

export type PdfCorrectionImpact = {
  affectedBlocks: number;
  affectedTransactions: number;
  transactionCountBefore: number;
  transactionCountAfter: number;
};

export function applyGuidanceCorrections(
  guidance: PdfParserGuidance,
  corrections: PdfCorrection[]
) {
  return corrections.reduce((current, correction) =>
    correction.kind === "set-guidance" ? { ...current, ...correction.patch } : current
  , guidance);
}

export function applyBlockCorrections(blocks: PdfTransactionBlock[], corrections: PdfCorrection[]) {
  let output = blocks.map((block) => ({ ...block, rowIds: [...block.rowIds], sourceIds: [...block.sourceIds] }));
  corrections.forEach((correction) => {
    if (correction.kind === "ignore-block" || correction.kind === "restore-block") {
      output = output.map((block) => block.id === correction.blockId
        ? { ...block, excluded: correction.kind === "ignore-block" }
        : block);
    }
    if (correction.kind === "merge-blocks") {
      const selected = output.filter((block) => correction.blockIds.includes(block.id));
      if (selected.length < 2) return;
      const first = selected[0];
      const merged: PdfTransactionBlock = {
        ...first,
        rowIds: selected.flatMap((block) => block.rowIds),
        sourceIds: selected.flatMap((block) => block.sourceIds),
        width: Math.max(...selected.map((block) => block.x + block.width)) - Math.min(...selected.map((block) => block.x)),
        height: Math.max(...selected.filter((block) => block.pageNumber === first.pageNumber).map((block) => block.y + block.height)) - first.y,
        manuallyCreated: true,
      };
      output = output.flatMap((block) => block.id === first.id ? [merged] : correction.blockIds.includes(block.id) ? [] : [block]);
    }
    if (correction.kind === "split-block") {
      const block = output.find((candidate) => candidate.id === correction.blockId);
      const splitIndex = block?.rowIds.indexOf(correction.beforeRowId) ?? -1;
      if (!block || splitIndex <= 0) return;
      const before = { ...block, rowIds: block.rowIds.slice(0, splitIndex), manuallyCreated: true };
      const after = { ...block, id: `${block.id}-split-${correction.beforeRowId}`, rowIds: block.rowIds.slice(splitIndex), manuallyCreated: true };
      output = output.flatMap((candidate) => candidate.id === block.id ? [before, after] : [candidate]);
    }
    // `mark-row` is materialized by the pipeline, where reconstructed row
    // geometry is available. It is intentionally not guessed here.
  });
  return output;
}

export function applyFieldCorrections(
  transactions: PdfTransactionProposal[],
  corrections: PdfCorrection[]
) {
  return transactions.map((transaction) => {
    let output = { ...transaction, confidence: { ...transaction.confidence } };
    corrections.forEach((correction) => {
      if ((correction.kind === "set-field" || correction.kind === "set-direction") && !correction.transactionIds.includes(transaction.id)) return;
      if (correction.kind === "set-field") {
        output = { ...output, [correction.field]: correction.value };
        const accepted = { status: "accepted" as const, score: 1, reasons: ["ROW_MANUALLY_CHANGED" as const], sourceIds: [] };
        if (correction.field === "transactionDate") output.confidence = { ...output.confidence, transactionDate: correction.value ? accepted : rejected("DATE_INVALID") };
        if (correction.field === "postedDate") output.confidence = { ...output.confidence, postingDate: correction.value ? accepted : null };
        if (correction.field === "valueDate") output.confidence = { ...output.confidence, valueDate: correction.value ? accepted : null };
        if (correction.field === "importDate") output.confidence = { ...output.confidence, importDate: correction.value ? accepted : rejected("DATE_INVALID") };
        if (correction.field === "description") output.confidence = { ...output.confidence, description: correction.value?.trim() ? accepted : rejected("DESCRIPTION_MISSING") };
        if (correction.field === "reference") output.confidence = { ...output.confidence, reference: correction.value ? accepted : null };
        if (correction.field === "currency") {
          const currency = correction.value?.trim().toUpperCase() || null;
          output.currency = currency;
          output.exactAmount = output.exactAmount ? { ...output.exactAmount, currency } : null;
          output.confidence = {
            ...output.confidence,
            currency: currency ? accepted : rejected("CURRENCY_AMBIGUOUS"),
          };
        }
        if (correction.field === "amount") {
          const decimal = correction.value ? parseExactDecimal(correction.value, "auto") : null;
          output.exactAmount = decimal && decimal.coefficient !== BigInt(0)
            ? {
                coefficient: decimal.coefficient.toString(),
                scale: decimal.scale,
                currency: output.currency,
                raw: correction.value ?? "",
                sourceIds: [],
              }
            : null;
          output.confidence = {
            ...output.confidence,
            accountAmount: output.exactAmount
              ? accepted
              : decimal ? rejected("AMOUNT_ZERO") : rejected("AMOUNT_MISSING"),
          };
        }
      }
      if (correction.kind === "set-direction") {
        const magnitude = output.amount.replace(/^[+-]/, "");
        output = {
          ...output,
          direction: correction.direction,
          directionEvidence: "manual",
          amount: `${correction.direction === "debit" ? "-" : ""}${magnitude}`,
          confidence: {
            ...output.confidence,
            direction: { status: "accepted", score: 1, reasons: ["ROW_MANUALLY_CHANGED"], sourceIds: [] },
          },
        };
      }
      if (correction.kind === "set-field" || correction.kind === "set-direction") {
        output.issueCodes = [...new Set([...output.issueCodes, "ROW_MANUALLY_CHANGED"] as const)];
      }
      if (correction.kind === "accept-transaction" && correction.transactionIds.includes(transaction.id)) {
        const accept = (field: PdfTransactionProposal["confidence"]["rowBoundary"] | null) =>
          field?.status === "review" ? {
            ...field,
            status: "accepted" as const,
            score: Math.max(field.score, 0.8),
            reasons: field.reasons.filter(isEvidenceReason),
          } : field;
        const confidence: PdfTransactionProposal["confidence"] = {
          ...output.confidence,
          rowBoundary: accept(output.confidence.rowBoundary)!,
          transactionDate: accept(output.confidence.transactionDate)!,
          postingDate: accept(output.confidence.postingDate),
          valueDate: accept(output.confidence.valueDate),
          importDate: accept(output.confidence.importDate)!,
          description: accept(output.confidence.description)!,
          reference: accept(output.confidence.reference),
          accountAmount: accept(output.confidence.accountAmount)!,
          originalAmount: accept(output.confidence.originalAmount),
          exchangeRate: accept(output.confidence.exchangeRate),
          fees: output.confidence.fees.map((field) => accept(field)!),
          vat: output.confidence.vat.map((field) => accept(field)!),
          direction: accept(output.confidence.direction)!,
          currency: accept(output.confidence.currency)!,
          balance: accept(output.confidence.balance),
        };
        output = { ...output, confidence, status: "accepted" };
      }
    });
    const fields = confidenceFields(output);
    output.status = fields.some((field) => field.status === "rejected")
      ? "rejected"
      : fields.some((field) => field.status === "review")
        ? "review"
        : "accepted";
    output.issueCodes = [...new Set(fields.flatMap((field) => field.reasons))];
    return output;
  });
}

function isEvidenceReason(reason: PdfTransactionProposal["issueCodes"][number]) {
  return [
    "AMOUNT_FROM_MAPPED_COLUMN",
    "DIRECTION_FROM_DEBIT_COLUMN",
    "DIRECTION_FROM_CREDIT_COLUMN",
    "DIRECTION_FROM_MARKER",
    "DIRECTION_FROM_SIGN",
    "DIRECTION_FROM_BALANCE",
    "DIRECTION_FROM_SECTION",
    "DIRECTION_EXPLICIT_POLICY",
    "BALANCE_RECONCILED",
    "ROW_MANUALLY_CHANGED",
  ].includes(reason);
}

function rejected(reason: "DATE_INVALID" | "DESCRIPTION_MISSING" | "AMOUNT_MISSING" | "AMOUNT_ZERO" | "CURRENCY_AMBIGUOUS") {
  return { status: "rejected" as const, score: 0, reasons: [reason], sourceIds: [] };
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

export function correctionImpact(
  blocks: PdfTransactionBlock[],
  transactions: PdfTransactionProposal[],
  corrections: PdfCorrection[]
): PdfCorrectionImpact {
  const nextBlocks = applyBlockCorrections(blocks, corrections);
  const targetIds = new Set(corrections.flatMap((correction) =>
    "transactionIds" in correction ? correction.transactionIds : []
  ));
  return {
    affectedBlocks: nextBlocks.filter((block, index) => block.id !== blocks[index]?.id || block.excluded !== blocks[index]?.excluded).length,
    affectedTransactions: transactions.filter((transaction) => targetIds.has(transaction.id)).length,
    transactionCountBefore: transactions.length,
    transactionCountAfter: nextBlocks.filter((block) => !block.excluded).length,
  };
}
