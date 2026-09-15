"use client";

/**
 * Month range picker.
 *
 * Vendored from https://github.com/gr3enk/shadcn-ui-monthpicker
 * (`src/components/ui/monthrangepicker.tsx`), copied from the repository rather
 * than installed through the author's own shadcn registry, so what ships here
 * is what was read.
 *
 * It needs nothing new: `addMonths` is defined in the file, so there is no
 * date-fns dependency, and the only imports are lucide icons, this project's
 * `Button` and `cn`. Written against Radix-era shadcn, but it consumes only
 * `<Button variant size>` and `buttonVariants`, both of which this project's
 * Base UI button implements.
 *
 * Local changes are marked `// local:`.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "./button";
import { cn } from "@/lib/utils";

const addMonths = (input: Date, months: number) => {
    const date = new Date(input);
    date.setDate(1);
    date.setMonth(date.getMonth() + months);
    date.setDate(Math.min(input.getDate(), getDaysInMonth(date.getFullYear(), date.getMonth() + 1)));
    return date;
};
const getDaysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

type Month = {
    number: number;
    name: string;
    yearOffset: number;
};

const MONTHS: Month[][] = [
    [
        { number: 0, name: "Jan", yearOffset: 0 },
        { number: 1, name: "Feb", yearOffset: 0 },
        { number: 2, name: "Mar", yearOffset: 0 },
        { number: 3, name: "Apr", yearOffset: 0 },
        { number: 0, name: "Jan", yearOffset: 1 },
        { number: 1, name: "Feb", yearOffset: 1 },
        { number: 2, name: "Mar", yearOffset: 1 },
        { number: 3, name: "Apr", yearOffset: 1 },
    ],
    [
        { number: 4, name: "May", yearOffset: 0 },
        { number: 5, name: "Jun", yearOffset: 0 },
        { number: 6, name: "Jul", yearOffset: 0 },
        { number: 7, name: "Aug", yearOffset: 0 },
        { number: 4, name: "May", yearOffset: 1 },
        { number: 5, name: "Jun", yearOffset: 1 },
        { number: 6, name: "Jul", yearOffset: 1 },
        { number: 7, name: "Aug", yearOffset: 1 },
    ],
    [
        { number: 8, name: "Sep", yearOffset: 0 },
        { number: 9, name: "Oct", yearOffset: 0 },
        { number: 10, name: "Nov", yearOffset: 0 },
        { number: 11, name: "Dec", yearOffset: 0 },
        { number: 8, name: "Sep", yearOffset: 1 },
        { number: 9, name: "Oct", yearOffset: 1 },
        { number: 10, name: "Nov", yearOffset: 1 },
        { number: 11, name: "Dec", yearOffset: 1 },
    ],
];

type QuickSelector = {
    label: string;
    startMonth: Date;
    endMonth: Date;
    variant?: ButtonVariant;
    onClick?: (selector: QuickSelector) => void;
};

const QUICK_SELECTORS: QuickSelector[] = [
    { label: "This year", startMonth: new Date(new Date().getFullYear(), 0), endMonth: new Date(new Date().getFullYear(), 11) },
    { label: "Last year", startMonth: new Date(new Date().getFullYear() - 1, 0), endMonth: new Date(new Date().getFullYear() - 1, 11) },
    // local: the range includes both ends, so the offset is one less than the
    // count - upstream subtracted the full count and selected 7 and 13 months.
    { label: "Last 6 months", startMonth: new Date(addMonths(new Date(), -5)), endMonth: new Date() },
    { label: "Last 12 months", startMonth: new Date(addMonths(new Date(), -11)), endMonth: new Date() },
];

type MonthRangeCalProps = {
    selectedMonthRange?: { start: Date; end: Date };
    onStartMonthSelect?: (date: Date) => void;
    onMonthRangeSelect?: ({ start, end }: { start: Date; end: Date }) => void;
    onYearForward?: () => void;
    onYearBackward?: () => void;
    callbacks?: {
        yearLabel?: (year: number) => string;
        monthLabel?: (month: Month) => string;
    };
    variant?: {
        calendar?: {
            main?: ButtonVariant;
            selected?: ButtonVariant;
        };
        chevrons?: ButtonVariant;
    };
    minDate?: Date;
    maxDate?: Date;
    quickSelectors?: QuickSelector[];
    showQuickSelectors?: boolean;
};

type ButtonVariant = "default" | "outline" | "ghost" | "link" | "destructive" | "secondary" | null | undefined;

function MonthRangePicker({
    onMonthRangeSelect,
    onStartMonthSelect,
    callbacks,
    selectedMonthRange,
    onYearBackward,
    onYearForward,
    variant,
    minDate,
    maxDate,
    quickSelectors,
    showQuickSelectors,
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & MonthRangeCalProps) {
    return (
        <div className={cn("min-w-[320px] p-2", className)} {...props}>  {/* local: tighter frame */}
            <div className="flex flex-col sm:flex-row space-y-2 sm:space-x-2 sm:space-y-0">  {/* local */}
                <div className="w-full">
                    <MonthRangeCal
                        onMonthRangeSelect={onMonthRangeSelect}
                        onStartMonthSelect={onStartMonthSelect}
                        callbacks={callbacks}
                        selectedMonthRange={selectedMonthRange}
                        onYearBackward={onYearBackward}
                        onYearForward={onYearForward}
                        variant={variant}
                        minDate={minDate}
                        maxDate={maxDate}
                        quickSelectors={quickSelectors}
                        showQuickSelectors={showQuickSelectors}
                    ></MonthRangeCal>
                </div>
            </div>
        </div>
    );
}

function MonthRangeCal({
    selectedMonthRange,
    onMonthRangeSelect,
    onStartMonthSelect,
    callbacks,
    variant,
    minDate,
    maxDate,
    quickSelectors = QUICK_SELECTORS,
    showQuickSelectors = true,
    onYearBackward,
    onYearForward,
}: MonthRangeCalProps) {
    const [startYear, setStartYear] = React.useState<number>(selectedMonthRange?.start.getFullYear() ?? new Date().getFullYear());
    const [startMonth, setStartMonth] = React.useState<number>(selectedMonthRange?.start?.getMonth() ?? new Date().getMonth());
    const [endYear, setEndYear] = React.useState<number>(selectedMonthRange?.end?.getFullYear() ?? new Date().getFullYear() + 1);
    const [endMonth, setEndMonth] = React.useState<number>(selectedMonthRange?.end?.getMonth() ?? new Date().getMonth());
    const [rangePending, setRangePending] = React.useState<boolean>(false);
    const [endLocked, setEndLocked] = React.useState<boolean>(true);
    /*
     * local: open on [previous year, selected year] rather than [selected year,
     * next year]. The two columns are `menuYear` and `menuYear + 1`, and
     * anchoring `menuYear` to the selection put the selected months in the left
     * column with a year of empty future months beside them. Budgets are read
     * backwards - "how does this compare with last year" - so the year that
     * earns the second column is the one behind, not the one ahead.
     */
    const [menuYear, setMenuYear] = React.useState<number>(startYear - 1);

    // local: normalise into a local rather than reassigning the prop -
    // `react-hooks/immutability` is error-severity under this repo's config.
    const lowerBound = minDate && maxDate && minDate > maxDate ? maxDate : minDate;

    return (
        <div className="flex gap-2">  {/* local */}
            <div className="min-w-[320px] space-y-2">  {/* local */}
                <div className="flex justify-evenly pt-1 relative items-center">
                    <div className="text-xs font-medium">{callbacks?.yearLabel ? callbacks?.yearLabel(menuYear) : menuYear}</div>  {/* local */}
                    <div className="space-x-1 flex items-center">
                        <button
                            type="button"
                            aria-label={`Show ${menuYear - 1} and ${menuYear}`}  /* local */
                            onClick={() => {
                                setMenuYear(menuYear - 1);
                                if (onYearBackward) onYearBackward();
                            }}
                            className={cn(buttonVariants({ variant: variant?.chevrons ?? "outline" }), "inline-flex items-center justify-center h-6 w-6 p-0 absolute left-1"  /* local */)}
                        >
                            <ChevronLeft className="opacity-50 h-3.5 w-3.5" />  {/* local */}
                        </button>
                        <button
                            type="button"
                            aria-label={`Show ${menuYear + 1} and ${menuYear + 2}`}  /* local */
                            onClick={() => {
                                setMenuYear(menuYear + 1);
                                if (onYearForward) onYearForward();
                            }}
                            className={cn(buttonVariants({ variant: variant?.chevrons ?? "outline" }), "inline-flex items-center justify-center h-6 w-6 p-0 absolute right-1"  /* local */)}
                        >
                            <ChevronRight className="opacity-50 h-3.5 w-3.5" />  {/* local */}
                        </button>
                    </div>
                    <div className="text-xs font-medium">{callbacks?.yearLabel ? callbacks?.yearLabel(menuYear + 1) : menuYear + 1}</div>  {/* local */}
                </div>
                <table className="w-full border-collapse space-y-1">
                    <tbody>
                        {MONTHS.map((monthRow, a) => {
                            return (
                                <tr key={"row-" + a} className="flex w-full mt-1">  {/* local */}
                                    {monthRow.map((m, i) => {
                                        return (
                                            <td
                                                key={m.number + "-" + m.yearOffset}
                                                className={cn(
                                                    cn(
                                                        cn(
                                                            cn(
                                                                "h-7 w-1/4 text-center p-0 relative  /* local */ [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                                                                (menuYear + m.yearOffset > startYear || (menuYear + m.yearOffset == startYear && m.number > startMonth)) &&
                                                                    (menuYear + m.yearOffset < endYear || (menuYear + m.yearOffset == endYear && m.number < endMonth)) &&
                                                                    (rangePending || endLocked)
                                                                    ? "text-accent-foreground bg-accent"
                                                                    : ""
                                                            ),
                                                            menuYear + m.yearOffset == startYear && m.number == startMonth && (rangePending || endLocked)
                                                                ? "text-accent-foreground bg-accent rounded-l-md"
                                                                : ""
                                                        ),
                                                        menuYear + m.yearOffset == endYear &&
                                                            m.number == endMonth &&
                                                            (rangePending || endLocked) &&
                                                            menuYear + m.yearOffset >= startYear &&
                                                            m.number >= startMonth
                                                            ? "text-accent-foreground bg-accent rounded-r-md"
                                                            : ""
                                                    ),
                                                    i == 3 ? "mr-2" : i == 4 ? "ml-2" : ""
                                                )}
                                                onMouseEnter={() => {
                                                    if (rangePending && !endLocked) {
                                                        setEndYear(menuYear + m.yearOffset);
                                                        setEndMonth(m.number);
                                                    }
                                                }}
                                            >
                                                <button
                                                    onClick={() => {
                                                        if (rangePending) {
                                                            if (menuYear + m.yearOffset < startYear || (menuYear + m.yearOffset == startYear && m.number < startMonth)) {
                                                                setRangePending(true);
                                                                setEndLocked(false);
                                                                setStartMonth(m.number);
                                                                setStartYear(menuYear + m.yearOffset);
                                                                setEndYear(menuYear + m.yearOffset);
                                                                setEndMonth(m.number);
                                                                if (onStartMonthSelect) onStartMonthSelect(new Date(menuYear + m.yearOffset, m.number));
                                                            } else {
                                                                setRangePending(false);
                                                                setEndLocked(true);
                                                                // Event fire data selected

                                                                if (onMonthRangeSelect)
                                                                    onMonthRangeSelect({ start: new Date(startYear, startMonth), end: new Date(menuYear + m.yearOffset, m.number) });
                                                            }
                                                        } else {
                                                            setRangePending(true);
                                                            setEndLocked(false);
                                                            setStartMonth(m.number);
                                                            setStartYear(menuYear + m.yearOffset);
                                                            setEndYear(menuYear + m.yearOffset);
                                                            setEndMonth(m.number);
                                                            if (onStartMonthSelect) onStartMonthSelect(new Date(menuYear + m.yearOffset, m.number));
                                                        }
                                                    }}
                                                    disabled={
                                                        (maxDate
                                                            ? menuYear + m.yearOffset > maxDate?.getFullYear() || (menuYear + m.yearOffset == maxDate?.getFullYear() && m.number > maxDate.getMonth())
                                                            : false) ||
                                                        (lowerBound
                                                            ? menuYear + m.yearOffset < lowerBound?.getFullYear() || (menuYear + m.yearOffset == lowerBound?.getFullYear() && m.number < lowerBound.getMonth())
                                                            : false)
                                                    }
                                                    className={cn(
                                                        buttonVariants({
                                                            variant:
                                                                (startMonth == m.number && menuYear + m.yearOffset == startYear) ||
                                                                (endMonth == m.number && menuYear + m.yearOffset == endYear && !rangePending)
                                                                    ? variant?.calendar?.selected ?? "default"
                                                                    : variant?.calendar?.main ?? "ghost",
                                                        }),
                                                        // local: the size has to be set on the button.
                                                        // `buttonVariants` carries `text-sm` in its base,
                                                        // so a size on the cell never reached the label.
                                                        // `text-xs` matches the year header above it.
                                                        "h-full w-full p-0 text-xs font-normal aria-selected:opacity-100"
                                                    )}
                                                    /*
                                                      local: the grid shows two
                                                      years side by side, so a
                                                      bare "Jan" names two
                                                      different months - and
                                                      selection was carried by
                                                      colour alone.
                                                    */
                                                    aria-label={`${m.name} ${menuYear + m.yearOffset}`}
                                                    aria-pressed={
                                                        (startMonth == m.number && menuYear + m.yearOffset == startYear) ||
                                                        (endMonth == m.number && menuYear + m.yearOffset == endYear && !rangePending)
                                                    }
                                                >
                                                    {callbacks?.monthLabel ? callbacks.monthLabel(m) : m.name}
                                                </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {showQuickSelectors ? (
                <div className="flex flex-col gap-1 justify-center">  {/* local */}
                    {quickSelectors.map((s) => {
                        /*
                          local: a quick selector is clamped to the same bounds
                          the month buttons enforce. It used to send its range
                          straight through, so "This year" could select December
                          in a window that only holds data to September - months
                          the grid itself refuses to offer.
                        */
                        const start = lowerBound && s.startMonth < lowerBound ? lowerBound : s.startMonth;
                        const end = maxDate && s.endMonth > maxDate ? maxDate : s.endMonth;
                        // Clamping can invert a range that sat wholly outside
                        // the window; there is nothing to select then.
                        const selectable = start <= end;
                        return (
                            <Button
                                disabled={!selectable}
                                onClick={() => {
                                    if (!selectable) return;
                                    setStartYear(start.getFullYear());
                                    setStartMonth(start.getMonth());
                                    setEndYear(end.getFullYear());
                                    setEndMonth(end.getMonth());
                                    setRangePending(false);
                                    setEndLocked(true);
                                    if (onMonthRangeSelect) onMonthRangeSelect({ start, end });
                                    if (s.onClick) s.onClick(s);
                                }}
                                key={s.label}
                                variant={s.variant ?? "outline"}
                                size="sm"
                                className="h-7 justify-start px-2.5 text-xs font-normal"  /* local: compact */
                            >
                                {s.label}
                            </Button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}

MonthRangePicker.displayName = "MonthRangePicker";

export { MonthRangePicker };
