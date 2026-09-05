"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function TagInput({
  values,
  onChange,
  placeholder = "Type and press Enter…",
  compact = false,
  ariaLabel,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  compact?: boolean;
  /** Accessible name for the entry field. The chips carry their own remove labels. */
  ariaLabel?: string;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  }

  function removeTag(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }

  return (
    <div
      className={cn(
        "flex min-h-8 flex-1 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1",
        compact && "min-h-7 py-0.5"
      )}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="flex items-center gap-0.5 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground"
        >
          {v}
          <button
            type="button"
            onClick={() => removeTag(i)}
            aria-label={`Remove ${v}`}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
          if (e.key === "Backspace" && !input && values.length > 0) removeTag(values.length - 1);
        }}
        onBlur={addTag}
        placeholder={values.length === 0 ? placeholder : "add more…"}
        aria-label={ariaLabel}
        className="min-w-20 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </div>
  );
}
