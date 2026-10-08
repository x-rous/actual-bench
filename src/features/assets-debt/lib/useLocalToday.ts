"use client";
import { useEffect, useState } from "react";
import { localToday } from "./calendarDate";
export function useLocalToday(): string {
  const [date, setDate] = useState(localToday);
  useEffect(() => {
    const update = () => setDate(localToday());
    const timer = setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return date;
}
