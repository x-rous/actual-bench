/**
 * QIF statement parsing (RD-072 §2.5).
 *
 * QIF is a line format: one letter per line says what the rest of the line is,
 * and a lone `^` ends a transaction. Actual's `qif2json` recognises more tags
 * than its importer persists, and the analysis doc is explicit that the parser
 * alone must not be read as the persisted behaviour — so this module parses the
 * tags it can and `structured.ts` decides what becomes a statement row.
 *
 * What is deliberately parsed but not carried into a `StatementRow`:
 *
 * - `L` category / subcategory — reconciliation never categorises (RD-071).
 * - `S`/`E`/`$` split detail — the statement's counterpart is the split parent,
 *   which carries the posted total (`T`).
 * - `A` address, `C` cleared status — no reconciliation decision reads them; the
 *   cleared state is the user's Apply choice, not the file's claim.
 *
 * They stay in `raw` so nothing the file said is lost to the user.
 */

import type { StructuredStatementTransaction } from "./structured";

/**
 * Does this text look like a QIF file?
 *
 * Scans past the file's preamble rather than judging the first line. Quicken
 * routinely writes an `!Account` block ahead of `!Type:Bank`, and stopping at
 * line one calls that file "not QIF" — which an upload survives on its
 * extension, but a paste or a `.txt` export does not: it is then read as a
 * delimited table and produces nonsense rows with no error to explain them.
 *
 * The scan gives up as soon as it sees something no QIF file contains, so a CSV
 * costs a line or two rather than a full pass. Only an explicit `!Type:` header
 * returns true, so nothing can be mistaken *for* QIF.
 */
export function looksLikeQif(text: string): boolean {
  let inspected = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^!type:/i.test(trimmed)) return true;

    // Everything legitimately above a `!Type:` header is section material:
    // other `!` directives, the single-letter tag lines of an `!Account` block,
    // and the `^` that terminates them.
    const isSectionMaterial = /^[!^]/.test(trimmed) || /^[A-Za-z$]/.test(trimmed);
    if (!isSectionMaterial) return false;
    if (++inspected >= 40) return false;
  }
  return false;
}

export type ParsedQif = {
  /** The `!Type:` the file declared (`Bank`, `CCard`, …), when it declared one. */
  type: string | null;
  transactions: StructuredStatementTransaction[];
};

/**
 * `!Type:` values that introduce lists rather than transactions.
 *
 * These matter because their records reuse the transaction tag letters for
 * entirely different things — an `!Account` block's `T` is the account's *type*,
 * not an amount — so a parser that reads every record the same way invents
 * transactions out of a file's header material.
 */
const NON_TRANSACTION_TYPES = new Set([
  "cat",
  "class",
  "memorized",
  "prices",
  "security",
  "payee",
  "tag",
  "invitem",
  "template",
]);

export function parseQif(text: string): ParsedQif {
  const lines = text.split(/\r?\n/);
  const transactions: StructuredStatementTransaction[] = [];

  let type: string | null = null;
  let fields: Record<string, string> | null = null;
  let sourceRowNumber = 0;
  // A file with no section header at all is still worth reading: some exports
  // omit it, and every record in them is a transaction.
  let inTransactions = true;

  const flush = () => {
    if (!fields || !inTransactions) {
      fields = null;
      return;
    }
    // A record with nothing but a stray tag is not a transaction; requiring at
    // least a date or an amount keeps trailing `^`s out.
    if (fields.D || fields.T) {
      sourceRowNumber += 1;
      transactions.push({
        sourceRowNumber,
        date: fields.D ?? null,
        amount: fields.T ?? fields.U ?? null,
        payeeText: fields.P ?? null,
        memoText: fields.M ?? null,
        reference: fields.N ?? null,
        externalId: null,
        raw: { ...fields },
      });
    }
    fields = null;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;

    if (line === "^") {
      flush();
      continue;
    }

    // `!Type:Bank`, `!Account`, `!Option:AutoSwitch`, … Section headers, not
    // transaction data: they end whatever record was open.
    if (line.startsWith("!")) {
      flush();
      const match = /^!type:(.*)$/i.exec(line);
      if (match) {
        const declared = match[1].trim();
        inTransactions = !NON_TRANSACTION_TYPES.has(declared.toLowerCase());
        // Reported as the file's type only when it is one: a `!Type:Cat` list
        // preceding the real statement should not rename it.
        if (inTransactions) type = declared || null;
      } else {
        // `!Account`, `!Option:…`, `!Clear:…` — everything until the next
        // `!Type:` belongs to the file's structure, not to its transactions.
        inTransactions = false;
      }
      continue;
    }

    if (!inTransactions) continue;

    const tag = line[0].toUpperCase();
    const value = decodeQif(line.slice(1).trim());
    const record = fields ?? (fields = {});

    // Later occurrences append rather than overwrite: multi-line addresses and
    // some banks' multi-line memos arrive as repeated tags, and dropping all but
    // one of them would silently lose half a merchant name.
    const existing = record[tag];
    record[tag] = existing === undefined ? value : `${existing} ${value}`.trim();
  }

  // Files that end without a final `^` are common enough to tolerate.
  flush();

  return { type, transactions };
}

/** QIF escapes only ampersands in practice, and only in payee text. */
function decodeQif(value: string): string {
  return value.replace(/&amp;/g, "&");
}
