import {
  Car,
  CircleDashed,
  CircleDollarSign,
  CreditCard,
  FileText,
  Gem,
  House,
  Landmark,
  PiggyBank,
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
  retirement: PiggyBank,
  property: House,
  vehicle: Car,
  "other-asset": Gem,
  "credit-card": CreditCard,
  loan: CircleDollarSign,
  "other-liability": FileText,
};

export const UNCLASSIFIED_ICON: LucideIcon = CircleDashed;
