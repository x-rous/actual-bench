import Image from "next/image";
import type { Card } from "../lib/models";

/** Local Shopify Payment Icons assets; source and MIT notice accompany the SVGs. */
const networks: Record<Card["network"], { label: string; icon?: string }> = {
  unknown: { label: "Not set" },
  visa: { label: "Visa", icon: "visa" },
  mastercard: { label: "Mastercard", icon: "mastercard" },
  amex: { label: "American Express", icon: "amex" },
  discover: { label: "Discover", icon: "discover" },
  jcb: { label: "JCB", icon: "jcb" },
  unionpay: { label: "UnionPay", icon: "unionpay" },
  "diners-club": { label: "Diners Club", icon: "diners-club" },
  other: { label: "Other" },
};

export function cardNetworkLabel(network: Card["network"]) { return networks[network].label; }

export function CardNetworkLogo({ network, mark = false, lightInk = false, className }: { network: Card["network"]; mark?: boolean; lightInk?: boolean; className?: string }) {
  const { icon } = networks[network];
  if (!icon) return null;
  return <Image src={`/payment-networks/${mark ? "marks/" : ""}${icon}${mark && lightInk && network === "discover" ? "-light" : ""}.svg`} width={32} height={20} unoptimized alt="" aria-hidden="true" className={className ?? "h-5 w-8 shrink-0 object-contain"} />;
}

export function CardNetwork({ network }: { network: Card["network"] }) {
  const { label } = networks[network];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap align-middle">
      <CardNetworkLogo network={network} />
      <span>{label}</span>
    </span>
  );
}

export const CARD_NETWORK_OPTIONS = (Object.keys(networks) as Card["network"][]).map((value) => ({
  value,
  label: <CardNetwork network={value} />,
}));
