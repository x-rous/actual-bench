"use client"

import * as React from "react"
import { format } from "date-fns"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { MonthCaptionProps } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"

type View = "days" | "months" | "years"

const MONTHS = Array.from({ length: 12 }, (_, month) => month)
const YEARS_PER_PAGE = 12

/** What the day view's title does when clicked: zoom out to the months. */
const ZoomOutContext = React.createContext<() => void>(() => {})

/**
 * The day view's title as a button. react-day-picker's own caption is
 * replaced through its supported `components` slot, so the day grid, its
 * keyboard handling and its labels stay the library's.
 */
function ZoomCaption(captionProps: MonthCaptionProps) {
  // The library's own label (children) is replaced, and displayIndex is not a
  // div attribute, so both are taken off before the rest reach the div.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { calendarMonth, displayIndex, children, ...props } = captionProps
  const zoomOut = React.useContext(ZoomOutContext)
  const label = format(calendarMonth.date, "MMMM yyyy")
  return (
    <div {...props}>
      {/* Above the absolutely placed arrows, which span the caption row. */}
      <button
        type="button"
        onClick={zoomOut}
        aria-label={`${label}, choose another month`}
        className="relative z-10 rounded-md px-2 py-0.5 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
      >
        {label}
      </button>
    </div>
  )
}

/**
 * A month calendar that zooms out, the way macOS and Google calendars do:
 * click "September 2026" for the twelve months of 2026, click "2026" for a
 * grid of years, and pick your way back in.
 */
export function DatePickerPanel({
  selected,
  onSelect,
}: {
  selected: Date | undefined
  onSelect: (date: Date) => void
}) {
  const [view, setView] = React.useState<View>("days")
  const [month, setMonth] = React.useState<Date>(() => selected ?? new Date())
  const year = month.getFullYear()
  const firstYear = year - (year % YEARS_PER_PAGE)
  const today = new Date()

  if (view === "months") {
    return (
      <ZoomGrid
        title={String(year)}
        titleLabel={`${year}, choose another year`}
        onTitle={() => setView("years")}
        previousLabel="Previous year"
        nextLabel="Next year"
        onPrevious={() => setMonth(new Date(year - 1, month.getMonth()))}
        onNext={() => setMonth(new Date(year + 1, month.getMonth()))}
        items={MONTHS.map((index) => {
          const date = new Date(year, index)
          return {
            key: index,
            label: format(date, "MMM"),
            fullLabel: format(date, "MMMM yyyy"),
            selected: selected?.getFullYear() === year && selected.getMonth() === index,
            current: today.getFullYear() === year && today.getMonth() === index,
            onPick: () => {
              setMonth(date)
              setView("days")
            },
          }
        })}
      />
    )
  }

  if (view === "years") {
    return (
      <ZoomGrid
        title={`${firstYear} - ${firstYear + YEARS_PER_PAGE - 1}`}
        previousLabel="Earlier years"
        nextLabel="Later years"
        onPrevious={() => setMonth(new Date(year - YEARS_PER_PAGE, month.getMonth()))}
        onNext={() => setMonth(new Date(year + YEARS_PER_PAGE, month.getMonth()))}
        items={Array.from({ length: YEARS_PER_PAGE }, (_, offset) => {
          const itemYear = firstYear + offset
          return {
            key: itemYear,
            label: String(itemYear),
            fullLabel: String(itemYear),
            selected: selected?.getFullYear() === itemYear,
            current: today.getFullYear() === itemYear,
            onPick: () => {
              setMonth(new Date(itemYear, month.getMonth()))
              setView("months")
            },
          }
        })}
      />
    )
  }

  return (
    <ZoomOutContext.Provider value={() => setView("months")}>
      <Calendar
        mode="single"
        selected={selected}
        month={month}
        onMonthChange={setMonth}
        onSelect={(date) => {
          if (date) onSelect(date)
        }}
        components={{ MonthCaption: ZoomCaption }}
        autoFocus
      />
    </ZoomOutContext.Provider>
  )
}

/** The months or years view: a title that zooms out further, arrows, and a 4×3 grid. */
function ZoomGrid({
  title,
  titleLabel,
  onTitle,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  items,
}: {
  title: string
  titleLabel?: string
  onTitle?: () => void
  previousLabel: string
  nextLabel: string
  onPrevious: () => void
  onNext: () => void
  items: {
    key: number
    label: string
    fullLabel: string
    selected: boolean
    current: boolean
    onPick: () => void
  }[]
}) {
  return (
    // The same width as the day view, so the popup does not jump in size.
    <div className="w-[13.75rem] p-3">
      <div className="flex h-7 items-center justify-between">
        <Button variant="ghost" size="icon-sm" aria-label={previousLabel} onClick={onPrevious}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        {onTitle ? (
          <button
            type="button"
            onClick={onTitle}
            aria-label={titleLabel}
            className="rounded-md px-2 py-0.5 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
          >
            {title}
          </button>
        ) : (
          <span className="text-sm font-medium">{title}</span>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={nextLabel} onClick={onNext}>
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onPick}
            aria-label={item.fullLabel}
            aria-pressed={item.selected}
            className={cn(
              "h-9 rounded-md text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
              item.current && !item.selected && "bg-accent text-accent-foreground",
              item.selected && "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
