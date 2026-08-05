"use client";

import { useEffect, useState } from "react";

/**
 * Returns the current `Date`, re-rendering once at each local midnight so that
 * date-derived UI (e.g. the current-month highlight and the time-of-month
 * marker, RD-067) doesn't go stale on a long-lived page left open across a day
 * or month boundary.
 */
export function useDailyDate(): Date {
  const [date, setDate] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      // A second past the next local midnight, so we're safely into the new day.
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1
      );
      timer = setTimeout(() => {
        setDate(new Date());
        schedule();
      }, nextMidnight.getTime() - now.getTime());
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return date;
}
