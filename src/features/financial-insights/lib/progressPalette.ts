/** The colours a Progress chart is drawn with. */
export type ShapePalette = {
  /** Text and the line that matters. */ ink: string;
  muted: string;
  /** Hairlines, including the zero line. */ rule: string;
  good: string;
  bad: string;
  /** The journey line. */ line: string;
  track: string;
  surface: string;
  /** The colours of the asset types, in the order Cash, Investments, Property, Other. */
  classes: [string, string, string, string];
};

/** On the page: the app's own tokens, so the tab follows the theme. */
export const THEME_PALETTE: ShapePalette = {
  ink: "var(--foreground)", muted: "var(--muted-foreground)", rule: "var(--border)", good: "var(--fi-up)", bad: "var(--fi-down)", line: "var(--fi-networth)", track: "var(--muted)", surface: "var(--card)", classes: ["var(--fi-cash)", "var(--fi-invest)", "var(--fi-property)", "var(--fi-g10)"],
};

/** In an exported image there is no stylesheet, so the same tokens are written out for each theme. */
export const IMAGE_PALETTES: Record<"light" | "dark", ShapePalette> = {
  light: { ink: "#0a0a0a", muted: "#737373", rule: "#d4d4d4", good: "#3f9a73", bad: "#e0655a", line: "#1f2a37", track: "#f1f0ed", surface: "#ffffff", classes: ["#10b981", "#3b82f6", "#6366f1", "#a3a29c"] },
  dark: { ink: "#fafafa", muted: "#a3a3a3", rule: "#404040", good: "#4fb88c", bad: "#e0776c", line: "#e8e6e3", track: "#383835", surface: "#171717", classes: ["#10b981", "#3b82f6", "#6366f1", "#77766f"] },
};

export const FONT_STACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
