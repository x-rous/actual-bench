/** The card colour palette, shared by the editor and the card mark. `null` is the default colour. */
export const DEFAULT_CARD_COLOR = "#262626";

export const CARD_COLORS = [
  { name: "Default", color: DEFAULT_CARD_COLOR },
  { name: "Navy", color: "#233a83" },
  { name: "Blue", color: "#2563eb" },
  { name: "Teal", color: "#0f766e" },
  { name: "Green", color: "#166534" },
  { name: "Red", color: "#991b1b" },
  { name: "Purple", color: "#6b21a8" },
  { name: "Amber", color: "#b08b34" },
  { name: "Gray", color: "#a3a3a3" },
] as const;

export const cardColor = (card: { color: string | null }) => card.color ?? DEFAULT_CARD_COLOR;
