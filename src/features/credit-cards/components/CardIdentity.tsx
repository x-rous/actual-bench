import type { Card } from "../lib/models";
import { cn } from "@/lib/utils";
import { CardNetworkLogo, cardNetworkLabel } from "./CardNetwork";
import { cardColor } from "../lib/cardColors";

export { cardColor };
/** Account identity sits alongside the card; its accessible name identifies the network. */
export function CardMark({ card, preview = false }: { card: Pick<Card, "color"> & Partial<Pick<Card, "network">>; preview?: boolean }) {
  const color = cardColor(card);
  const rgb = color.slice(1).match(/../g)!.map((value) => parseInt(value, 16));
  const light = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 180;
  const label = card.network && card.network !== "unknown" ? `${cardNetworkLabel(card.network)} card` : undefined;
  return <span
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    className={cn("relative inline-block shrink-0 overflow-hidden rounded-[5px] border border-black/10 shadow-xs", preview ? "h-10 w-16" : "h-7 w-11")}
    style={{ backgroundColor: color, backgroundImage: "linear-gradient(135deg, rgb(255 255 255 / 6%), rgb(0 0 0 / 8%))" }}
  >
    <span className={cn("absolute left-1.5 top-1.5 rounded-[2px] border border-black/10 bg-[#d8c77b]", preview ? "h-2.5 w-3.5" : "h-2 w-3")} />
    {card.network && <CardNetworkLogo network={card.network} mark lightInk={!light} className={cn(
      "absolute object-contain",
      preview ? "bottom-1 right-1 h-3.5 w-6" : "bottom-0.5 right-0.5 h-2.5 w-5",
      light && (card.network === "visa" || card.network === "amex") && "brightness-0",
    )} />}
  </span>;
}
