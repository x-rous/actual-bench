"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useIsHydrated } from "@/hooks/useIsHydrated";
import { Button } from "@/components/ui/button";

const THEMES = ["system", "light", "dark"] as const;
const LABELS = { system: "System", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useIsHydrated();
  const current = THEMES.find(value => hydrated && value === theme) ?? "system";
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  const Icon = current === "system" ? Monitor : current === "light" ? Sun : Moon;
  const label = `Theme: ${LABELS[current]}. Switch to ${LABELS[next]}`;
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title={label} aria-label={label} onClick={() => setTheme(next)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
