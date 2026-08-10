"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { generateId } from "@/lib/uuid";
import { parseStatementText } from "@/lib/reconciliation/statement/parse";
import {
  detectColumnMapping,
  normalizeStatement,
  type ColumnMapping,
  type NormalizedStatement,
  type SignConvention,
  type StatementDateFormat,
} from "@/lib/reconciliation/statement/normalize";
import type { MatchConfig } from "@/lib/reconciliation/types";
import type { TextTargetPreset } from "@/lib/reconciliation/match/config";
import { MatchOptions } from "./MatchOptions";
import { formatMinorUnits } from "../lib/format";

/**
 * Screen 2 — import and parse (UX §5).
 *
 * Answers one question before any matching happens: did Actual Bench read the
 * statement correctly? Wrong date interpretation, inverted debits, and
 * mis-parsed amounts all become visible here rather than as mysterious
 * non-matches later.
 */

const DATE_FORMATS: { value: StatementDateFormat; label: string }[] = [
  { value: "iso", label: "2026-07-03" },
  { value: "dmy", label: "03/07/2026 (day first)" },
  { value: "mdy", label: "07/03/2026 (month first)" },
  { value: "dmy-name", label: "03 Jul 2026" },
  { value: "ymd-compact", label: "20260703" },
];

const SIGN_CONVENTIONS: { value: SignConvention; label: string }[] = [
  { value: "signed", label: "One amount column, already signed" },
  { value: "debit-credit", label: "Separate debit and credit columns" },
  { value: "signed-inverted", label: "One amount column, spend shown positive" },
];

type ColumnSelectProps = {
  id: string;
  label: string;
  value: number | undefined;
  columns: string[];
  onChange: (value: number | undefined) => void;
  optional?: boolean;
};

function ColumnSelect({ id, label, value, columns, onChange, optional }: ColumnSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
        {optional && <span className="ml-1 text-muted-foreground">(optional)</span>}
      </Label>
      <select
        id={id}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : Number(event.target.value))
        }
      >
        <option value="">—</option>
        {columns.map((column, index) => (
          <option key={`${column}-${index}`} value={index}>
            {column}
          </option>
        ))}
      </select>
    </div>
  );
}

export type ImportPanelProps = {
  accountName: string;
  matchConfig: MatchConfig;
  matchPreset: TextTargetPreset;
  onMatchConfigChange: (preset: TextTargetPreset, config: MatchConfig) => void;
  onCancel: () => void;
  onParsed: (result: NormalizedStatement, statementName: string | null) => void;
  isSaving?: boolean;
};

export function ImportPanel({
  accountName,
  matchConfig,
  matchPreset,
  onMatchConfigChange,
  onCancel,
  onParsed,
  isSaving,
}: ImportPanelProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);

  const table = useMemo(() => (text.trim() ? parseStatementText(text) : null), [text]);

  const columns = useMemo(() => {
    if (!table) return [];
    const width = Math.max(table.headers?.length ?? 0, ...table.rows.map((row) => row.length), 0);
    return Array.from({ length: width }, (_, index) => table.headers?.[index] || `Column ${index + 1}`);
  }, [table]);

  // Seed the mapping by detection the first time a table appears. Getting the
  // debit/credit case wrong here signs every outflow positive, and since
  // matching requires the exact signed amount, nothing would match at all.
  const effectiveMapping = useMemo<ColumnMapping | null>(() => {
    if (!table || columns.length === 0) return null;
    return mapping ?? detectColumnMapping(table);
  }, [table, columns, mapping]);

  const parsed = useMemo(() => {
    if (!table || !effectiveMapping) return null;
    return normalizeStatement(table, effectiveMapping, () => generateId());
  }, [table, effectiveMapping]);

  function update(patch: Partial<ColumnMapping>) {
    if (!effectiveMapping) return;
    setMapping({ ...effectiveMapping, ...patch });
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (file.size > CSV_MAX_BYTES) {
      setFileError(`That file is larger than ${Math.round(CSV_MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setText(await file.text());
    setFileName(file.name);
  }

  const totals = parsed?.totals;
  const canContinue = Boolean(parsed && parsed.rows.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div>
        <h2 className="text-sm font-semibold">Import statement</h2>
        <p className="text-xs text-muted-foreground">
          {accountName} · paste from a spreadsheet or upload a CSV. Nothing is written to your
          budget at this stage.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring">
          <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
      </div>

      {fileError && (
        <p role="alert" className="text-xs text-destructive">
          {fileError}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="statement-text" className="text-xs">
          Or paste statement rows
        </Label>
        <textarea
          id="statement-text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // A new paste invalidates a mapping chosen for the previous shape.
            setMapping(null);
          }}
          rows={6}
          spellCheck={false}
          placeholder={"2026-07-01\tCARREFOUR MARKET\t-342.85"}
          className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
        />
      </div>

      {table && effectiveMapping && (
        <>
          <div className="rounded-md border border-border/60 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Column mapping
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ColumnSelect
                id="map-date"
                label="Posted date"
                value={effectiveMapping.date}
                columns={columns}
                onChange={(value) => update({ date: value ?? 0 })}
              />
              <ColumnSelect
                id="map-description"
                label="Description"
                value={effectiveMapping.description}
                columns={columns}
                onChange={(value) => update({ description: value ?? 0 })}
              />
              {effectiveMapping.signConvention === "debit-credit" ? (
                <>
                  <ColumnSelect
                    id="map-debit"
                    label="Debit (money out)"
                    value={effectiveMapping.debit}
                    columns={columns}
                    onChange={(value) => update({ debit: value })}
                  />
                  <ColumnSelect
                    id="map-credit"
                    label="Credit (money in)"
                    value={effectiveMapping.credit}
                    columns={columns}
                    onChange={(value) => update({ credit: value })}
                  />
                </>
              ) : (
                <ColumnSelect
                  id="map-amount"
                  label="Amount"
                  value={effectiveMapping.amount}
                  columns={columns}
                  onChange={(value) => update({ amount: value })}
                />
              )}
              <ColumnSelect
                id="map-reference"
                label="Reference"
                value={effectiveMapping.reference}
                columns={columns}
                onChange={(value) => update({ reference: value })}
                optional
              />

              <div className="flex flex-col gap-1">
                <Label htmlFor="map-date-format" className="text-xs">
                  Date format
                </Label>
                <select
                  id="map-date-format"
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={effectiveMapping.dateFormat}
                  onChange={(event) =>
                    update({ dateFormat: event.target.value as StatementDateFormat })
                  }
                >
                  {DATE_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="map-sign" className="text-xs">
                  Amount convention
                </Label>
                <select
                  id="map-sign"
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={effectiveMapping.signConvention}
                  onChange={(event) =>
                    update({ signConvention: event.target.value as SignConvention })
                  }
                >
                  {SIGN_CONVENTIONS.map((convention) => (
                    <option key={convention.value} value={convention.value}>
                      {convention.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="map-decimal" className="text-xs">
                  Decimal separator
                </Label>
                <select
                  id="map-decimal"
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={effectiveMapping.decimalSeparator}
                  onChange={(event) =>
                    update({ decimalSeparator: event.target.value as "." | "," })
                  }
                >
                  <option value=".">1,234.56</option>
                  <option value=",">1.234,56</option>
                </select>
              </div>
            </div>
          </div>

          <MatchOptions
            config={matchConfig}
            preset={matchPreset}
            onChange={onMatchConfigChange}
          />

          {parsed && (
            <div className="rounded-md border border-border/60">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-2 text-xs">
                <span className="font-medium">{parsed.rows.length} rows parsed</span>
                {parsed.errors.length > 0 && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {parsed.errors.length} could not be read
                  </span>
                )}
                {parsed.period && (
                  <span className="text-muted-foreground">
                    {parsed.period.start} → {parsed.period.end}
                  </span>
                )}
              </div>

              <table className="w-full text-xs">
                <caption className="sr-only">Preview of the parsed statement rows</caption>
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/40">
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Date</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Description</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Reference</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((row) => (
                    <tr key={row.id} className="border-b border-border/20 last:border-0">
                      <td className="px-3 py-1.5 tabular-nums">{row.postedDate}</td>
                      <td className="max-w-0 truncate px-3 py-1.5">{row.description}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{row.reference ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatMinorUnits(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {totals && (
                <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border/60 px-3 py-2 text-xs">
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Debits</dt>
                    <dd className="tabular-nums">{formatMinorUnits(totals.debits)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Credits</dt>
                    <dd className="tabular-nums">{formatMinorUnits(totals.credits)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Net</dt>
                    <dd className="font-medium tabular-nums">{formatMinorUnits(totals.net)}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}

          {parsed && parsed.errors.length > 0 && (
            <details className="rounded-md border border-amber-500/30 p-3 text-xs">
              <summary className="cursor-pointer font-medium">
                {parsed.errors.length} rows could not be read
              </summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {parsed.errors.slice(0, 10).map((error) => (
                  <li key={error.sourceRowNumber}>
                    Row {error.sourceRowNumber}: {error.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!canContinue || isSaving}
          onClick={() => parsed && onParsed(parsed, fileName)}
        >
          {isSaving ? "Matching…" : "Match against Actual"}
        </Button>
      </div>
    </div>
  );
}
