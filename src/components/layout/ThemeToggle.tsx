"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const THEME_ORDER = ["system", "light", "dark"] as const;
const THEME_LABELS: Record<string, string> = { system: "System", light: "Light", dark: "Dark" };

/** Cycles system, light and dark. */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  // Icon reflects the resolved appearance (so system+dark OS shows Moon); label reflects the stored mode.
  const Icon = resolvedTheme === "light" ? Sun : resolvedTheme === "dark" ? Moon : Monitor;
  const label = THEME_LABELS[theme ?? "system"];

  function cycle() {
    const idx = THEME_ORDER.indexOf((theme ?? "system") as (typeof THEME_ORDER)[number]);
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={cycle}
      title={`Theme: ${label} - click to cycle`}
      aria-label={`Theme: ${label}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
