"use client"

import * as React from "react"
import { CalendarDays } from "lucide-react"
import { format, parse } from "date-fns"

import { DatePickerPanel } from "@/components/ui/date-picker-panel"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useBudgetDateFormat } from "@/hooks/useBudgetDateFormat"
import { dateFormatHint, formatTypedDate, parseTypedDate } from "@/lib/dates/typedDate"
import { cn } from "@/lib/utils"

/**
 * The app's date field, the way Actual's works: type the date as free text in
 * the budget's own date format (Settings → Formatting), or pick it from the
 * calendar beside it. `15/8` means this year, `15/8/26` this century, and a
 * pasted ISO date is always understood (see `lib/dates/typedDate`).
 *
 * The value is ISO `yyyy-MM-dd`, or "" for no date. Typing is committed on
 * Enter or when the field is left; text that is not a date stays on screen
 * and is marked, rather than being thrown away or saved as a guess.
 */
function DateInput({
  value,
  onValueChange,
  size = "default",
  className,
  inputClassName,
  dateFormat: dateFormatOverride,
  disabled,
  id,
  title,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  ...dataProps
}: {
  value: string
  onValueChange: (value: string) => void
  size?: "sm" | "default"
  /** Sizes the field (usually a width). */
  className?: string
  /** Styles the text box itself, e.g. borderless inside a table cell. */
  inputClassName?: string
  /** The budget's own format unless given. */
  dateFormat?: string
  disabled?: boolean
  id?: string
  title?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  [dataAttribute: `data-${string}`]: string | undefined
}) {
  const budgetFormat = useBudgetDateFormat()
  const dateFormat = dateFormatOverride ?? budgetFormat
  const [draft, setDraft] = React.useState(() => formatTypedDate(value, dateFormat))
  const [invalid, setInvalid] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [shown, setShown] = React.useState({ value, dateFormat })
  // A new value from outside (or a format change) replaces what is shown.
  if (shown.value !== value || shown.dateFormat !== dateFormat) {
    setShown({ value, dateFormat })
    setDraft(formatTypedDate(value, dateFormat))
    setInvalid(false)
  }

  function commit(text: string) {
    if (!text.trim()) {
      setInvalid(false)
      if (value) onValueChange("")
      return
    }
    const iso = parseTypedDate(text, dateFormat)
    if (!iso) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    // The same date written another way still tidies up on screen.
    setDraft(formatTypedDate(iso, dateFormat))
    if (iso !== value) onValueChange(iso)
  }

  const selected = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined

  return (
    <div className={cn("relative flex w-full min-w-0 items-center", className)}>
      <Input
        {...dataProps}
        id={id}
        size={size}
        title={title}
        aria-label={ariaLabel}
        aria-invalid={invalid || ariaInvalid || undefined}
        disabled={disabled}
        placeholder={dateFormatHint(dateFormat)}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          if (invalid) setInvalid(false)
        }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit(event.currentTarget.value)
          }
        }}
        className={cn("pr-7 tabular-nums", inputClassName)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              aria-label={ariaLabel ? `Choose ${ariaLabel.toLowerCase()} from a calendar` : "Choose a date from a calendar"}
              className="absolute right-1.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <CalendarDays className="size-3.5" aria-hidden="true" />
            </button>
          }
        />
        <PopoverContent align="end" className="w-auto p-0">
          <DatePickerPanel
            selected={selected}
            onSelect={(date) => {
              const iso = format(date, "yyyy-MM-dd")
              setInvalid(false)
              setDraft(formatTypedDate(iso, dateFormat))
              if (iso !== value) onValueChange(iso)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export { DateInput }
