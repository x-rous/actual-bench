"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { generateId } from "@/lib/uuid";
import {
  fingerprintStatement,
  normalizeParseConfig,
  type NormalizedStatement,
  type SignConvention,
  type StatementDateFormat,
  type StatementParseConfig,
} from "@/lib/reconciliation/statement/normalize";
import {
  STATEMENT_FORMAT_LABELS,
  detectParseConfig,
  detectStatementFormat,
  hasAmbiguousDates,
  parseStatement,
} from "@/lib/reconciliation/statement/source";
import type { MatchConfig } from "@/lib/reconciliation/types";
import type { TextTargetPreset } from "@/lib/reconciliation/match/config";
import type { ReconciliationProfileRecord } from "../lib/reconciliationApi";
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

/** What the file picker offers, and what the paste box can also be. */
const ACCEPTED_EXTENSIONS = ".csv,.tsv,.txt,.ofx,.qfx,.qif";

type ColumnSelectProps = {
  id: string;
  label: string;
  value: number | undefined;
  columns: string[];
  onChange: (value: number | undefined) => void;
  optional?: boolean;
  /**
   * Omit the "-" choice.
   *
   * For a column the statement cannot do without. Offering "-" for one of those
   * was worse than not offering it: the choice could not be honoured, so it
   * silently snapped the mapping to column 0 — which is normally the date, and
   * would have put dates into the field.
   */
  required?: boolean;
};

function ColumnSelect({
  id,
  label,
  value,
  columns,
  onChange,
  optional,
  required,
}: ColumnSelectProps) {
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
        {!required && <option value="">-</option>}
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
  /** Saved profiles for this account, most recently used first. */
  profiles: ReconciliationProfileRecord[];
  onMatchConfigChange: (preset: TextTargetPreset, config: MatchConfig) => void;
  onApplyProfile: (profile: ReconciliationProfileRecord) => void;
  onSaveProfile: (name: string, parseConfig: StatementParseConfig) => void;
  isSavingProfile?: boolean;
  /**
   * Reports the parsed statement upward as it changes, so the phase button can
   * live in the page toolbar with the other navigation rather than at the foot
   * of this panel where it reads as one more control among many.
   */
  onReadyChange: (result: NormalizedStatement | null, statementName: string | null) => void;
  /**
   * Statements already imported, by fingerprint. Held here rather than resolved
   * by the caller because only this panel knows what has been parsed yet.
   */
  knownStatements?: {
    fingerprint: string;
    accountName: string | null;
    tag: string | null;
    createdAt: string;
  }[];
};

export function ImportPanel({
  accountName,
  matchConfig,
  matchPreset,
  profiles,
  onMatchConfigChange,
  onApplyProfile,
  onSaveProfile,
  isSavingProfile,
  onReadyChange,
  knownStatements,
}: ImportPanelProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [config, setConfig] = useState<StatementParseConfig | null>(null);
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");

  const source = useMemo(
    () => (text.trim() ? { text, fileName } : null),
    [text, fileName]
  );

  // What the file *is*, decided from its content and name — not from whatever
  // the last profile happened to be about. A saved CSV profile applied to an
  // OFX export must not read it as a table of one enormous column.
  const detectedFormat = useMemo(
    () => (source ? detectStatementFormat(source) : null),
    [source]
  );

  // Seeded by detection the first time a statement appears. Getting the
  // debit/credit case wrong here signs every outflow positive, and since
  // matching requires the exact signed amount, nothing would match at all.
  const effectiveConfig = useMemo<StatementParseConfig | null>(() => {
    if (!source || !detectedFormat) return null;
    if (config && config.format === detectedFormat) return config;
    return detectParseConfig(source);
  }, [source, detectedFormat, config]);

  const parsed = useMemo(() => {
    if (!source || !effectiveConfig) return null;
    return parseStatement(source, effectiveConfig, () => generateId());
  }, [source, effectiveConfig]);

  const table = parsed?.table ?? null;
  const isDelimited = effectiveConfig?.format === "delimited";

  // Unresolvable from the file, so it has to be said out loud: where every date
  // falls in the first twelve days of its month, `03/07` is either the 3rd of
  // July or the 7th of March and detection had to pick one.
  const datesAmbiguous = useMemo(
    () => (source && effectiveConfig ? hasAmbiguousDates(source, effectiveConfig) : false),
    [source, effectiveConfig]
  );

  const columns = useMemo(() => {
    if (!table) return [];
    const width = Math.max(table.headers?.length ?? 0, ...table.rows.map((row) => row.length), 0);
    return Array.from({ length: width }, (_, index) => table.headers?.[index] || `Column ${index + 1}`);
  }, [table]);

  function update(patch: Partial<StatementParseConfig>) {
    if (!effectiveConfig) return;
    setConfig({ ...effectiveConfig, ...patch });
    // Once the user edits the settings they are no longer the saved profile, and
    // saying otherwise would be a lie about what is about to run.
    setAppliedProfileId(null);
  }

  function updateColumns(patch: Partial<StatementParseConfig["columns"]>) {
    if (!effectiveConfig) return;
    update({ columns: { ...effectiveConfig.columns, ...patch } });
  }

  function applyProfile(profile: ReconciliationProfileRecord) {
    // Checked rather than cast: a profile is JSON from the app database, and one
    // missing its `columns` would otherwise throw while rendering this panel.
    const saved = profile.mapping == null ? null : normalizeParseConfig(profile.mapping);
    // A profile carries column indexes for one file shape; the format still
    // comes from the file in front of us.
    if (saved) setConfig(detectedFormat ? { ...saved, format: detectedFormat } : saved);
    setAppliedProfileId(profile.id);
    setProfileName(profile.name);
    onApplyProfile(profile);
  }

  const appliedProfile = profiles.find((profile) => profile.id === appliedProfileId) ?? null;
  const suggestedProfile = profiles[0] ?? null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (file.size > CSV_MAX_BYTES) {
      setFileError(`That file is larger than ${Math.round(CSV_MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setText(await file.text());
    setFileName(file.name);
    // A new file is a new shape: settings chosen for the previous one — column
    // indexes above all — would silently mis-read it.
    setConfig(null);
    setAppliedProfileId(null);
  }

  const totals = parsed?.totals;
  const canContinue = Boolean(parsed && parsed.rows.length > 0);

  // Reported rather than acted on here: the panel owns parsing, the page owns
  // moving to the next phase.
  useEffect(() => {
    onReadyChange(canContinue && parsed ? parsed : null, fileName);
  }, [canContinue, parsed, fileName, onReadyChange]);

  // Recognised by the rows themselves, so a statement pasted last month and
  // uploaded this month is still the same statement.
  const duplicateOf = useMemo(() => {
    if (!parsed || parsed.rows.length === 0 || !knownStatements?.length) return null;
    const fingerprint = fingerprintStatement(parsed.rows);
    if (!fingerprint) return null;
    return knownStatements.find((entry) => entry.fingerprint === fingerprint) ?? null;
  }, [parsed, knownStatements]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      {/* The account is named in the session header above; repeating it here
          just pushed the uploader further down the page. */}
      <p className="text-xs text-muted-foreground">
        Paste from a spreadsheet, or upload a CSV/TSV, OFX/QFX or QIF file. Nothing is written to
        your budget at this stage.
      </p>

      {suggestedProfile && !appliedProfile && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
          <span>
            Saved profile for this account:{" "}
            <span className="font-medium">{suggestedProfile.name}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => applyProfile(suggestedProfile)}
          >
            Use it
          </Button>
        </div>
      )}

      {appliedProfile && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
          <span>
            Using <span className="font-medium">{appliedProfile.name}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => {
              setConfig(null);
              setAppliedProfileId(null);
            }}
          >
            Detect from the file instead
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring">
          <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Upload a statement
          <input
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
        {/* Said out loud, because everything below it depends on the answer:
            which mapping controls appear, whether dates need a format, and how
            the two text channels were filled. */}
        {effectiveConfig && (
          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            Read as {STATEMENT_FORMAT_LABELS[effectiveConfig.format]}
          </span>
        )}
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
            // A new paste invalidates settings chosen for the previous shape.
            setConfig(null);
            setFileName(null);
          }}
          rows={6}
          spellCheck={false}
          placeholder={"2026-07-01\tCARREFOUR MARKET\t-342.85"}
          className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
        />
      </div>

      {effectiveConfig && (
        <>
          <div className="rounded-md border border-border/60 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {isDelimited ? "Column mapping" : "How this file is read"}
            </h3>

            {/*
              Named for where they end up, not for what the bank calls them.
              "Description / payee" becomes the imported payee — the bank's own
              text, kept whatever payee you settle on — and "Notes / memo" is a
              separate channel, not an alternative to it.
            */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {isDelimited && (
                <>
                  <ColumnSelect
                    id="map-date"
                    label="Posted date"
                    value={effectiveConfig.columns.date}
                    columns={columns}
                    required
                    onChange={(value) => updateColumns({ date: value ?? 0 })}
                  />
                  <ColumnSelect
                    id="map-imported-payee"
                    label="Description / payee"
                    value={effectiveConfig.columns.importedPayee}
                    columns={columns}
                    onChange={(value) => updateColumns({ importedPayee: value })}
                  />
                  <ColumnSelect
                    id="map-notes"
                    label="Notes / memo"
                    value={effectiveConfig.columns.notes}
                    columns={columns}
                    onChange={(value) => updateColumns({ notes: value })}
                    optional
                  />
                  {effectiveConfig.signConvention === "debit-credit" ? (
                    <>
                      <ColumnSelect
                        id="map-debit"
                        label="Debit (money out)"
                        value={effectiveConfig.columns.debit}
                        columns={columns}
                        onChange={(value) => updateColumns({ debit: value })}
                      />
                      <ColumnSelect
                        id="map-credit"
                        label="Credit (money in)"
                        value={effectiveConfig.columns.credit}
                        columns={columns}
                        onChange={(value) => updateColumns({ credit: value })}
                      />
                    </>
                  ) : (
                    <ColumnSelect
                      id="map-amount"
                      label="Amount"
                      value={effectiveConfig.columns.amount}
                      columns={columns}
                      onChange={(value) => updateColumns({ amount: value })}
                    />
                  )}
                  <ColumnSelect
                    id="map-reference"
                    label="Reference"
                    value={effectiveConfig.columns.reference}
                    columns={columns}
                    onChange={(value) => updateColumns({ reference: value })}
                    optional
                  />
                </>
              )}

              {/* OFX states its dates unambiguously; QIF does not. */}
              {effectiveConfig.format !== "ofx" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="map-date-format" className="text-xs">
                    Date format
                  </Label>
                  <select
                    id="map-date-format"
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={effectiveConfig.dateFormat}
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
                  {datesAmbiguous && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Every date in this file could be read either way round - check the preview
                      below and correct this if the days and months are swapped.
                    </p>
                  )}
                </div>
              )}

              {isDelimited && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="map-sign" className="text-xs">
                    Amount convention
                  </Label>
                  <select
                    id="map-sign"
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={effectiveConfig.signConvention}
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
              )}

              {effectiveConfig.format !== "ofx" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="map-decimal" className="text-xs">
                    Decimal separator
                  </Label>
                  <select
                    id="map-decimal"
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={effectiveConfig.decimalSeparator}
                    onChange={(event) =>
                      update({ decimalSeparator: event.target.value as "." | "," })
                    }
                  >
                    <option value=".">1,234.56</option>
                    <option value=",">1.234,56</option>
                  </select>
                </div>
              )}
            </div>

            {/*
              Leaving the merchant column unmapped is allowed — a statement whose
              one text column is genuinely a memo should be able to say so — but
              it changes what reconciliation can do with the file, so it says
              what it costs rather than letting the user find out later.
            */}
            {isDelimited && effectiveConfig.columns.importedPayee === undefined && (
              <p role="status" className="mt-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                No description/payee column: nothing will be recorded as the imported payee, and no
                payee will be resolved from the statement.{" "}
                {effectiveConfig.columns.notes === undefined
                  ? "With no notes column either, rows will be matched on amount and date alone."
                  : "Matching will compare the notes column instead."}
              </p>
            )}

            {/*
              Structured files say which text is the payee and which is the
              memo — but some banks fill those fields the wrong way round, or
              leave the payee empty. These are repairs for that, exactly as
              Actual's own importer offers them.
            */}
            {!isDelimited && (
              <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={effectiveConfig.swapPayeeAndMemo}
                    onChange={(event) => update({ swapPayeeAndMemo: event.target.checked })}
                  />
                  <span>
                    This bank swaps the payee and memo fields
                    <span className="block text-[11px] text-muted-foreground">
                      Use the memo as the merchant text and the payee field as the notes.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={effectiveConfig.fallbackPayeeToMemo}
                    onChange={(event) => update({ fallbackPayeeToMemo: event.target.checked })}
                  />
                  <span>
                    Use the memo when the payee field is empty
                    <span className="block text-[11px] text-muted-foreground">
                      The memo becomes the merchant text and is not repeated in the notes.
                    </span>
                  </span>
                </label>
              </div>
            )}
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
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Imported payee</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Notes</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Reference</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((row) => (
                    <tr key={row.id} className="border-b border-border/20 last:border-0">
                      <td className="px-3 py-1.5 tabular-nums">{row.postedDate}</td>
                      <td className="max-w-0 truncate px-3 py-1.5">{row.importedPayee}</td>
                      <td className="max-w-0 truncate px-3 py-1.5 text-muted-foreground">
                        {row.bankNotes ?? "-"}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {row.bankReference ?? row.externalId ?? "-"}
                      </td>
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

      {effectiveConfig && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border/60 p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="profile-name" className="text-xs">
              Save these settings for {accountName}
            </Label>
            <input
              id="profile-name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder={`${accountName} statement`}
              className="h-8 w-72 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isSavingProfile}
            onClick={() =>
              onSaveProfile(profileName.trim() || `${accountName} statement`, effectiveConfig)
            }
          >
            {isSavingProfile ? "Saving…" : "Save profile"}
          </Button>
          <p className="w-full text-[11px] text-muted-foreground">
            Stores how this statement is read and the matching options, so next month&apos;s
            statement needs no setting up. Saving again under the same name replaces it.
          </p>
        </div>
      )}

      {/*
        Warned, not blocked. Re-importing a statement is a legitimate thing to
        do — after a partial apply, or to redo a month with a corrected mapping
        — so this says what it found and leaves the decision alone.
      */}
      {duplicateOf && canContinue && (
        <div
          role="status"
          className="rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            This statement has been imported before
          </p>
          <p className="mt-0.5 text-muted-foreground">
            The same rows were imported for {duplicateOf.accountName ?? "this account"}
            {duplicateOf.tag ? ` (${duplicateOf.tag})` : ""} on{" "}
            {new Date(duplicateOf.createdAt).toLocaleDateString()}. Carrying on is fine - matching
            reads what is in Actual now, and anything already applied is recognised and skipped -
            but if you meant to resume that reconciliation, go back and open it instead.
          </p>
        </div>
      )}


    </div>
  );
}
