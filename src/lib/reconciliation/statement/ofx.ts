/**
 * OFX / QFX statement parsing (RD-072 §2.5).
 *
 * QFX is OFX — Actual routes both extensions into the same parser, and so does
 * this one.
 *
 * Two dialects exist and both are handled by the same reader:
 *
 * - **OFX 1.x** is SGML. Aggregates (`<STMTTRN>…</STMTTRN>`) are closed, leaf
 *   elements (`<NAME>ACME STORE`) are not.
 * - **OFX 2.x** is XML, where everything is closed.
 *
 * A tolerant tag scan handles both without an XML dependency, and without the
 * SGML-to-XML rewriting Actual has to do before handing the text to a real
 * parser. That is a deliberate trade: OFX is machine-generated, shallow, and the
 * only thing we need out of it is a flat list of `STMTTRN` leaves. A strict
 * parser buys nothing here and fails on files banks really do emit.
 */

import type { StructuredStatementTransaction } from "./structured";

/** Does this text look like an OFX/QFX document? */
export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 4096).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX>") || head.includes("<OFX ");
}

/**
 * Header block preceding `<OFX>` in the 1.x dialect (`OFXHEADER:100`, …).
 *
 * Kept because `CHARSET`/`ENCODING` are occasionally the only clue about a file
 * that arrives mis-decoded, and because showing the user what the file declared
 * is cheaper than asking them to open it in a text editor.
 */
export function parseOfxHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const [before] = text.split(/<OFX[\s>]/i, 1);
  if (!before) return headers;
  for (const line of before.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z]+)\s*:\s*(.*?)\s*$/i);
    if (match) headers[match[1].toUpperCase()] = match[2];
  }
  return headers;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&#038;": "&",
  "&nbsp;": " ",
};

export function unescapeOfx(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#038);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** `20260801`, `20260801120000`, `20260801120000.000[-5:EST]` → `2026-08-01`. */
export function parseOfxDate(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.trim().replace(/^\D+/, "");
  const match = digits.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Leaf values inside one aggregate, by tag name.
 *
 * `<TAG>value` runs to the next `<`, which is correct for both dialects: in XML
 * the value stops at its own closing tag, in SGML at the next opening one. A tag
 * that appears twice keeps its **first** value — OFX nests `<PAYEE><NAME>` under
 * a transaction that may also carry its own `<NAME>`, and the transaction's own
 * value is the one that comes first.
 */
function readLeaves(block: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /<([A-Za-z0-9._]+)>([^<]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    const tag = match[1].toUpperCase();
    const value = unescapeOfx(match[2]).trim();
    if (!value) continue;
    if (!(tag in values)) values[tag] = value;
  }
  return values;
}

/**
 * Every `STMTTRN` aggregate in the document, wherever it sits.
 *
 * Bank, credit-card and investment statements nest them differently
 * (`BANKMSGSRSV1`, `CREDITCARDMSGSRSV1`, `INVSTMTMSGSRSV1/INVBANKTRAN`), and a
 * file can contain several statements at once. Since the aggregate name is
 * unambiguous, scanning for it directly covers all three shapes — and any future
 * one — without walking the message hierarchy.
 */
function statementTransactionBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) blocks.push(match[1]);
  return blocks;
}

export type ParsedOfx = {
  headers: Record<string, string>;
  transactions: StructuredStatementTransaction[];
};

export function parseOfx(text: string): ParsedOfx {
  const headers = parseOfxHeaders(text);

  const transactions = statementTransactionBlocks(text).map((block, index) => {
    const leaves = readLeaves(block);
    const transaction: StructuredStatementTransaction = {
      sourceRowNumber: index + 1,
      date: parseOfxDate(leaves.DTPOSTED ?? leaves.DTUSER ?? leaves.DTAVAIL),
      amount: leaves.TRNAMT ?? null,
      payeeText: leaves.NAME ?? null,
      memoText: leaves.MEMO ?? null,
      externalId: leaves.FITID ?? null,
      reference: leaves.CHECKNUM ?? leaves.REFNUM ?? null,
      type: leaves.TRNTYPE ?? null,
      raw: leaves,
    };
    return transaction;
  });

  return { headers, transactions };
}
