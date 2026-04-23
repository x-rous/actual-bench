import { ArrowLeft, ExternalLink, Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCellDisplay } from "../lib/cellFormatters";
import { findRelationship, type Relationship } from "../lib/relationshipMap";
import type { SchemaObjectType } from "../types";

export type RowDetailsSourceLayer = "raw" | "view";

export type RowDetailsEntry = {
  object: string;
  objectType: SchemaObjectType;
  sourceLayer: RowDetailsSourceLayer;
  columns: string[];
  row: Record<string, unknown> | null;
  keyColumn: string | null;
  keyValue: unknown;
  rowNumber?: number;
};

type RowDetailsSheetProps = {
  stack: RowDetailsEntry[];
  onBack: () => void;
  onClose: () => void;
  onFollowRelationship: (relationship: Relationship, value: unknown) => void;
};

function sourceLayerLabel(sourceLayer: RowDetailsSourceLayer): string {
  return sourceLayer === "view" ? "source: featured view" : "source: raw storage";
}

function keyLabel(entry: RowDetailsEntry): string {
  if (!entry.keyColumn) {
    return entry.rowNumber ? `row ${entry.rowNumber.toLocaleString("en-US")}` : "no key";
  }
  if (entry.keyValue === null || entry.keyValue === undefined) return `${entry.keyColumn}: NULL`;
  return `${entry.keyColumn}: ${String(entry.keyValue)}`;
}

function hasCellValue(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value === "");
}

function EmptyDetails() {
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Link2 className="mt-0.5 h-4 w-4" />
      <div>
        <p className="font-medium text-foreground">Row details</p>
        <p className="mt-1">
          Open a row or relationship link to inspect values and drill into related records.
        </p>
      </div>
    </div>
  );
}

export function RowDetailsSheet({
  stack,
  onBack,
  onClose,
  onFollowRelationship,
}: RowDetailsSheetProps) {
  const entry = stack.at(-1);

  if (!entry) return <EmptyDetails />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {stack.length > 1 && (
              <Button type="button" variant="ghost" size="icon-xs" onClick={onBack} title="Back">
                <ArrowLeft />
              </Button>
            )}
            <p className="truncate text-sm font-medium text-foreground" title={entry.object}>
              {entry.object}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{keyLabel(entry)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            {sourceLayerLabel(entry.sourceLayer)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} title="Close">
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-3">
        {!entry.row ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Target row was not found</p>
            <p className="mt-1">
              {entry.object} where {keyLabel(entry)}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entry.columns.map((column) => {
              const value = entry.row?.[column];
              const display = formatCellDisplay(column, value);
              const relationship = findRelationship(entry.object, column);
              const linked = relationship && hasCellValue(value);

              return (
                <div key={column} className="min-w-0">
                  <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <span>{column}</span>
                    {linked && <ExternalLink className="h-3 w-3" />}
                  </div>
                  {linked ? (
                    <button
                      type="button"
                      title={display.title}
                      onClick={() => onFollowRelationship(relationship, value)}
                      className={cn(
                        "mt-0.5 block max-w-full break-words text-left font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        display.kind === "binary" && "text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {display.text}
                    </button>
                  ) : (
                    <div
                      title={display.title}
                      className={cn(
                        "mt-0.5 break-words font-mono text-xs text-foreground",
                        display.kind === "null" && "text-muted-foreground/50",
                        display.kind === "binary" && "text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {display.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
