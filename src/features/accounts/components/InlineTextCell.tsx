"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * A cell that renders as readable text until clicked, then becomes an input.
 * Commits on blur or Enter, cancels on Escape.
 */
export function InlineTextCell({
  value,
  onCommit,
  placeholder,
  className,
  disabled = false,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onCommit(trimmed);
    } else {
      setDraft(value);
    }
    setIsEditing(false);
  }

  function cancel() {
    setDraft(value);
    setIsEditing(false);
  }

  if (disabled || !isEditing) {
    return (
      <span
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? undefined : 0}
        onClick={disabled ? undefined : () => { setDraft(value); setIsEditing(true); }}
        onKeyDown={disabled ? undefined : (e) => { if (e.key === "Enter") { setDraft(value); setIsEditing(true); } }}
        className={cn(
          "block w-full truncate rounded px-1 py-0.5",
          !disabled && "cursor-text hover:bg-muted/50",
          className
        )}
      >
        {value || <span className="text-muted-foreground">{placeholder ?? "—"}</span>}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") cancel();
      }}
      className={cn(
        "w-full rounded border border-ring bg-background px-1 py-0.5 text-sm outline-none",
        className
      )}
    />
  );
}
