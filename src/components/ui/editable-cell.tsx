"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export type DoneAction = "down" | "up" | "tab" | "shiftTab" | "cancel" | "blur";

/**
 * Inline text input for table cells.
 *
 * - Focuses on mount; selects all text unless startChar is provided
 *   (startChar means the user typed a key to open edit, so the field
 *   starts with that character instead of the full current value).
 * - Rejects empty commits: reverts to initialValue and fires "cancel".
 * - Guards against duplicate onDone calls via a committed ref.
 */
export function NameInput({
  initialValue,
  startChar,
  onDone,
  className,
}: {
  initialValue: string;
  startChar?: string;
  onDone: (value: string, action: DoneAction) => void;
  className?: string;
}) {
  const [value, setValue] = useState(startChar ?? initialValue);
  const [showError, setShowError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (!startChar) el.select();
  }, [startChar]);

  function done(action: DoneAction) {
    if (committed.current) return;
    if (action !== "cancel" && value.trim() === "") {
      committed.current = true;
      onDone(initialValue, "cancel");
      return;
    }
    committed.current = true;
    onDone(value, action);
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => { setValue(e.target.value); setShowError(false); }}
      onBlur={() => done("blur")}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter")     { e.preventDefault(); done("down"); }
        else if (e.key === "Escape")    { e.preventDefault(); done("cancel"); }
        else if (e.key === "Tab")       { e.preventDefault(); done(e.shiftKey ? "shiftTab" : "tab"); }
        else if (e.key === "ArrowDown") { e.preventDefault(); done("down"); }
        else if (e.key === "ArrowUp")   { e.preventDefault(); done("up"); }
      }}
      className={cn(
        "w-full min-w-0 border-0 bg-transparent p-0 text-sm leading-6 outline-none",
        showError && "placeholder:text-destructive",
        className
      )}
    />
  );
}
