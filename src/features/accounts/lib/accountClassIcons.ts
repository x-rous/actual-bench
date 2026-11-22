import {
  Car,
  CircleDashed,
  CircleDollarSign,
  CreditCard,
  FileText,
  Armchair,
  Gem,
  HandCoins,
  House,
  Landmark,
  PiggyBank,
  Vault,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { AccountClass } from "@/lib/account-class";

/** One icon per account class; kept out of `@/lib/account-class` so that module stays free of UI code. */
export const ACCOUNT_CLASS_ICONS: Record<AccountClass, LucideIcon> = {
  bank: Landmark,
  cash: Wallet,
  savings: PiggyBank,
  "fixed-deposit": Vault,
  investment: TrendingUp,
  retirement: Armchair,
  property: House,
  vehicle: Car,
  "fixed-asset": Gem,
  "other-asset": HandCoins,
  "credit-card": CreditCard,
  loan: CircleDollarSign,
  "other-liability": FileText,
};

export const UNCLASSIFIED_ICON: LucideIcon = CircleDashed;
