"use client";

import { X, Lightbulb } from "lucide-react";

/** Renders a line string, converting `backtick` spans to safe <code> elements. */
function ExplainLine({ line }: { line: string }) {
  const parts = line.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <code
            key={i}
            className="rounded bg-blue-100/80 px-1 font-mono text-[10px] dark:bg-blue-900/40"
          >
            {part}
          </code>
        )
      )}
    </>
  );
}

interface QueryExplanationPanelProps {
  lines: string[];
  onClose: () => void;
}

export function QueryExplanationPanel({
  lines,
  onClose,
}: QueryExplanationPanelProps) {
  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-blue-50/60 dark:bg-blue-950/20">
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700/70 dark:text-blue-400/70">
          Query explanation
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close explanation"
          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="flex flex-col gap-0.5 px-4 pb-2">
        {lines.map((line, i) => (
          <li
            key={i}
            className="flex items-start gap-1.5 text-xs text-blue-800 dark:text-blue-300"
          >
            <span className="mt-px shrink-0 text-blue-400">–</span>
            <span><ExplainLine line={line} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
