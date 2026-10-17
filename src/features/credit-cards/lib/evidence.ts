/** Opaque, versioned change-detection hashes. Not authentication or encryption. */
export function evidenceHash(value: unknown) {
  // 64-bit FNV-1a over UTF-16 code units: synchronous on plain-HTTP browsers too.
  const text = JSON.stringify(value);
  let hash = BigInt('14695981039346656037');
  for (let index = 0; index < text.length; index++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * BigInt('1099511628211'));
  }
  return `cc-v1:${hash.toString(16).padStart(16, '0')}`;
}

type FinancialRow = { id: string; accountId: string; date: string; amountMinor: number; transferKnown: boolean; transferId: string | null; parentId: string | null };
/** Compatibility for saved classifications/links; clearing and descriptive edits retain user intent. */
export function financialFingerprint(row: FinancialRow) {
  return evidenceHash([row.id, row.accountId, row.date, row.amountMinor, row.transferKnown, row.transferId, row.parentId]);
}
