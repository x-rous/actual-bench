import type { Card } from "../lib/models";
import { cn } from "@/lib/utils";
import { CardNetworkLogo, cardNetworkLabel } from "./CardNetwork";
export function cardColor(card: Pick<Card, "appearance" | "customColor">) { return card.customColor ?? ({ default: "#262626", navy: "#233a83", blue: "#2563eb", teal: "#0f766e", green: "#166534", red: "#991b1b", purple: "#6b21a8", amber: "#b08b34", gray: "#a3a3a3" }[card.appearance]); }
/** Account identity sits alongside the card; its accessible name identifies the network. */
export function CardMark({ card, preview = false }: { card: Pick<Card, "appearance" | "customColor"> & Partial<Pick<Card, "network">>; preview?: boolean }) {
  const color = cardColor(card);
  const rgb = color.slice(1).match(/../g)!.map((value) => parseInt(value, 16));
  const light = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 180;
  const label = card.network && card.network !== "unknown" ? `${cardNetworkLabel(card.network)} card` : undefined;
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("relative inline-block shrink-0 overflow-hidden rounded-[5px] border border-black/10 shadow-xs", preview ? "h-10 w-16" : "h-7 w-11")} style={{ backgroundColor: color, backgroundImage: "linear-gradient(135deg, rgb(255 255 255 / 6%), rgb(0 0 0 / 8%))" }}>
    <span className={cn("absolute left-1.5 top-1.5 rounded-[2px] border border-black/10 bg-[#d8c77b]", preview ? "h-2.5 w-3.5" : "h-2 w-3")} />
    {card.network && <CardNetworkLogo network={card.network} mark lightInk={!light} className={cn("absolute object-contain", preview ? "bottom-1 right-1 h-3.5 w-6" : "bottom-0.5 right-0.5 h-2.5 w-5", light && (card.network === "visa" || card.network === "amex") && "brightness-0")} />}
  </span>;
}
export function CreditRing({ percent }: { percent: number | null }) { const display = percent === null ? "-" : `${percent.toFixed(1)}%`; const bounded = Math.min(100, Math.max(0, percent ?? 0)); return <div className="relative size-24 shrink-0" role="img" aria-label={`Credit utilization ${display}`}><svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden><circle cx="50" cy="50" r="43" fill="none" stroke="var(--muted)" strokeWidth="10" /><circle cx="50" cy="50" r="43" fill="none" stroke="var(--chart-1)" strokeWidth="10" strokeDasharray={`${bounded * 2.702} 270.2`} /></svg><span className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums">{display}</span></div>; }
