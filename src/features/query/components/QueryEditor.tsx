"use client";

import { Play, WrapText, Save, Lightbulb, BookOpen, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonEditor } from "./JsonEditor";

const DEFAULT_PLACEHOLDER = `{
  "ActualQLquery": {
    "table": "transactions",
    "select": "*",
    "limit": 10
  }
}`;

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onFormat: () => void;
  onSave: () => void;
  onExplain: () => void;
  onCopyQuery: () => void;
  onOpenReference: () => void;
  onUndo?: () => boolean;
  isRunning: boolean;
  parseError: string | null;
  editorHeight: number;
}

export function QueryEditor({
  value,
  onChange,
  onRun,
  onFormat,
  onSave,
  onExplain,
  onCopyQuery,
  onOpenReference,
  onUndo,
  isRunning,
  parseError,
  editorHeight,
}: QueryEditorProps) {
  const shortcutHint =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? "⌘↵ to run"
      : "Ctrl+↵ to run";

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onRun();
    }
  }

  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      {/* Action bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" onClick={onRun} disabled={isRunning} className="gap-1.5">
          <Play className="h-3.5 w-3.5" />
          {isRunning ? "Running…" : "Run"}
        </Button>
        <Button size="sm" variant="outline" onClick={onFormat} className="gap-1.5">
          <WrapText className="h-3.5 w-3.5" />
          Format
        </Button>
        <Button size="sm" variant="outline" onClick={onSave} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onExplain} className="gap-1.5">
          <Lightbulb className="h-3.5 w-3.5" />
          Explain
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCopyQuery}
          title="Copy the current query to clipboard"
          className="gap-1.5"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy Query
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpenReference} className="gap-1.5">
          <BookOpen className="h-3.5 w-3.5" />
          Reference
        </Button>
        <span className="ml-auto text-xs text-muted-foreground/60">
          {shortcutHint}
        </span>
      </div>

      {/* Syntax-highlighted editor */}
      <JsonEditor
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        onUndo={onUndo}
        height={editorHeight}
        placeholder={DEFAULT_PLACEHOLDER}
      />

      {/* Inline parse error */}
      {parseError && (
        <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {parseError}
        </div>
      )}
    </div>
  );
}
