"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { commitFxImport, previewFxImport } from "../lib/fxApi";
import type { FxImportPreview } from "@/lib/fx/services/importFxRates";

/** CSV rate import with a validated preview (RD-056 / PR-025e). */
export function FxImportPanel({ onCommitted }: { onCommitted: () => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<FxImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewM = useMutation({
    mutationFn: () => previewFxImport(csv),
    onSuccess: (p) => { setPreview(p); setError(null); setDone(null); },
    onError: (e) => setError(e instanceof Error ? e.message : "Preview failed."),
  });
  const commitM = useMutation({
    mutationFn: () => commitFxImport(csv, "upload.csv"),
    onSuccess: ({ batch }) => { setDone(`Imported ${batch.insertedCount} new, ${batch.replacedCount} replaced, ${batch.rejectedCount} rejected.`); setPreview(null); setCsv(""); onCommitted(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Import failed."),
  });

  return (
    <details className="rounded-md border border-border bg-background text-sm shadow-sm">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-semibold">
        <Upload className="h-4 w-4 text-muted-foreground" /> Import rates from a CSV
      </summary>
      <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Header: <code className="rounded bg-muted px-1">date,base_currency,quote_currency,rate</code>. Uploaded rates
          override provider rates for the same pair and date; your manual overrides are kept.
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            aria-label="CSV file"
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setPreview(null);
              void file.text().then(setCsv);
            }}
          />
          <Button size="sm" variant="outline" type="button" onClick={() => fileRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" /> Choose CSV file
          </Button>
          {fileName && <span className="truncate text-xs text-muted-foreground">{fileName}</span>}
          <span className="text-xs text-muted-foreground">or paste below</span>
        </div>
        <textarea
          aria-label="CSV content"
          className="h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
          placeholder={"date,base_currency,quote_currency,rate\n2026-07-10,AED,AUD,0.4180"}
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!csv.trim() || previewM.isPending} onClick={() => previewM.mutate()}>{previewM.isPending ? "Checking…" : "Preview"}</Button>
          {preview && (
            <>
              <span className="text-xs text-muted-foreground">
                {preview.counts.insert} new · {preview.counts.replace} replace · {preview.counts.skip} skip · <span className={preview.counts.invalid ? "text-destructive" : ""}>{preview.counts.invalid} invalid</span>
              </span>
              <Button size="sm" disabled={commitM.isPending || preview.counts.insert + preview.counts.replace === 0} onClick={() => commitM.mutate()}>{commitM.isPending ? "Importing…" : "Import"}</Button>
            </>
          )}
        </div>
        {preview && preview.rows.some((r) => r.category === "invalid") && (
          <ul className="space-y-0.5 text-[11px] text-destructive">
            {preview.rows.filter((r) => r.category === "invalid").slice(0, 8).map((r, i) => (
              <li key={i}>Line {r.row.line}: {r.reason}</li>
            ))}
          </ul>
        )}
        {done && <p className="text-xs text-green-600 dark:text-green-400">{done}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </details>
  );
}
