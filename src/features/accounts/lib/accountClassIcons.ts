import {
  Car,
  CircleDashed,
  CircleDollarSign,
  CreditCard,
  FileText,
  Gem,
  HandCoins,
  House,
  Landmark,
  ReceiptText,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { AccountClass } from "@/lib/account-class";

/** One icon per account class; kept out of `@/lib/account-class` so that module stays free of UI code. */
export const ACCOUNT_CLASS_ICONS: Record<AccountClass, LucideIcon> = {
  cash: Wallet,
  bank: Landmark,
  investment: TrendingUp,
  property: House,
  vehicle: Car,
  receivable: HandCoins,
  "other-asset": Gem,
  "credit-card": CreditCard,
  loan: CircleDollarSign,
  payable: ReceiptText,
  "other-liability": FileText,
};

export const UNCLASSIFIED_ICON: LucideIcon = CircleDashed;
