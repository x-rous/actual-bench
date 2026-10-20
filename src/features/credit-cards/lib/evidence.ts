/** Opaque, versioned change-detection hashes. Not authentication or encryption. */
export const EVIDENCE_HASH_VERSION = "cc-v2";

/**
 * 64-bit digest from two independently mixed 32-bit lanes over UTF-16 code units.
 * `Math.imul` keeps it synchronous and fast on plain-HTTP browsers (no BigInt, no
 * SubtleCrypto). The input is the normalised JSON, so Direct and HTTP reads of the
 * same transaction produce the same digest.
 */
export function evidenceHash(value: unknown) {
  const text = JSON.stringify(value) ?? "undefined";
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  const hex = (lane: number) => (lane >>> 0).toString(16).padStart(8, "0");
  return `${EVIDENCE_HASH_VERSION}:${hex(b)}${hex(a)}`;
}

type FinancialRow = {
  id: string;
  accountId: string;
  date: string;
  amountMinor: number;
  transferKnown: boolean;
  transferId: string | null;
  parentId: string | null;
};

/**
 * Narrow identity for saved types and plan entries (D21): account, amount sign, transfer and split
 * parent. A date or amount change keeps the user's choice; only a structural change drops it.
 */
export function identityHash(row: Omit<FinancialRow, "date" | "transferKnown">) {
  return evidenceHash([row.id, row.accountId, Math.sign(row.amountMinor), row.transferId, row.parentId]);
}

/**
 * Full financial fingerprint (id, account, date, amount, transfer, parent). Statement decisions and
 * the verification signature use it; clearing, category and notes never change it (D20).
 */
export function financialFingerprint(row: FinancialRow) {
  return evidenceHash([
    row.id,
    row.accountId,
    row.date,
    row.amountMinor,
    row.transferKnown,
    row.transferId,
    row.parentId,
  ]);
}
