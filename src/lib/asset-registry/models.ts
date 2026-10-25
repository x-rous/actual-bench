import { z } from "zod";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { resolveAccountClass, type AccountClassMaps } from "@/lib/account-class";
import type { Account } from "@/types/entities";
import type { DepreciationSettings } from "./depreciation";
import type { AssetDebtLink } from "./financing";
import type { LinkRule } from "./linkRules";

export const ASSET_TYPES = {
  "real-estate": { label: "Property", accountClass: "property" },
  vehicle: { label: "Vehicle", accountClass: "vehicle" },
  investment: { label: "Investment", accountClass: "investment" },
  retirement: { label: "Retirement", accountClass: "retirement" },
  crypto: { label: "Crypto", accountClass: "investment" },
  "precious-metal": { label: "Precious Metal", accountClass: "other-asset" },
  collectible: { label: "Collectible / Valuable", accountClass: "other-asset" },
  other: { label: "Other Asset", accountClass: "other-asset" },
} as const;
export type AssetType = keyof typeof ASSET_TYPES;
export const BOOK_TYPES = {
  "opening-balance": "Opening Balance", acquisition: "Acquisition / Purchase",
  "capital-expenditure": "Capital expenditure (purchase or improvement)", revaluation: "Revaluation / Appreciation",
  depreciation: "Depreciation", impairment: "Impairment / Write-down",
  "ownership-adjustment": "Ownership Adjustment", disposal: "Disposal", "other-adjustment": "Other Adjustment",
} as const;
/** Shorter names for chart text and filter chips, where the full label would be too long. */
export const bookTypeShort = (type: string): string => type === "capital-expenditure" ? "Capital expenditure" : (BOOK_TYPES as Partial<Record<string, string>>)[type] ?? type;
export const CASHFLOW_TYPES = {
  "rental-income": "Rental Income", "dividends-distributions": "Dividends / Distributions", "interest-yield": "Interest / Yield", "other-income": "Other Income",
  "operating-expense": "Operating Expense / Maintenance", "taxes-insurance-service-charges": "Taxes / Insurance / Service Charges", "financing-interest": "Financing Interest",
  "capital-expenditure": "Capital Expenditure", "disposal-proceeds": "Disposal Proceeds", "other-excluded": "Other / Excluded",
} as const;
export type CashflowType = keyof typeof CASHFLOW_TYPES;
/** How the cashflow types read to the owner: what is income, what is expense, and what moves book value instead. */
export const CASHFLOW_GROUPS: { label: string; types: CashflowType[] }[] = [
  { label: "Income · counts toward Operating Result", types: ["rental-income", "dividends-distributions", "interest-yield", "other-income"] },
  { label: "Expenses · count toward Operating Result", types: ["operating-expense", "taxes-insurance-service-charges", "financing-interest"] },
  { label: "Capital & disposal · changes the asset's value, not Operating Result", types: ["capital-expenditure", "disposal-proceeds"] },
  { label: "Not counted", types: ["other-excluded"] },
];
/** All money in context is signed integer minor units; carrying removed is positive. */
export type AssetContext = { version: 1; data: {
  kind: "disposal"; representation: "external-receipt" | "asset-transfer" | "write-off"; carryingRemovedMinor: number;
  bookAdjustmentTransactionId: string | null; proceedsBasis?: "gross" | "net";
} | { kind: "selling-cost"; disposalTransactionId: string } };
export type BookType = keyof typeof BOOK_TYPES;
export const idSchema = z.string().trim().min(1).max(200);
export const dateSchema = z.string().refine(isIsoDate, "Use a valid YYYY-MM-DD date");
export const ownershipSchema = z.object({ effectiveFrom: dateSchema, ownershipBps: z.number().int().min(0).max(10000) }).strict();
export const assetInputSchema = z.object({
  id: idSchema, actualAccountId: idSchema, name: z.string().trim().min(1).max(200),
  assetType: z.enum(Object.keys(ASSET_TYPES) as [AssetType, ...AssetType[]]),
  description: z.string().trim().max(2000).nullable(), status: z.enum(["active", "archived"]),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  assetTag: z.string().regex(/^#asset_[a-z0-9_-]+$/, "Use a lowercase #asset_ hashtag").min(8).max(100).nullable().optional(),
  ownership: z.array(ownershipSchema).min(1).max(500),
  /** Omitted = the default for the asset type (see `defaultIncomeGenerating`). */
  incomeGenerating: z.boolean().optional(),
}).strict();
export type AssetInput = z.infer<typeof assetInputSchema>;
/** Whether an asset of this type is normally expected to produce income; the owner can override it per asset. */
export const defaultIncomeGenerating = (assetType: string): boolean => ["real-estate", "investment", "retirement", "crypto"].includes(assetType);
export type Asset = Omit<AssetInput, "assetType" | "status" | "incomeGenerating"> & {
  incomeGenerating: boolean;
  budgetSyncId: string; assetType: string; status: string; assetTag: string | null;
  createdAt: string; updatedAt: string; archivedAt: string | null;
};
export type BookMetadata = {
  actualTransactionId: string; actualAccountId: string; assetId: string | null;
  classification: string | null; revision: number; capitalizedFromTransactionId?: string | null; context?: AssetContext | null;
  /** `YYYY-MM` of a schedule-posted depreciation month (book rows only). */ depreciationPeriod?: string | null;
};
export type CashflowMetadata = BookMetadata & { assetId: string };
export type Registry = { assets: Asset[]; metadata: BookMetadata[]; cashflows?: CashflowMetadata[]; depreciation?: DepreciationSettings[]; debtLinks?: AssetDebtLink[]; linkRules?: LinkRule[] };
export const metadataChangeSchema = z.object({
  remove: z.boolean().optional(),
  actualTransactionId: idSchema, actualAccountId: idSchema, assetId: idSchema.nullable(),
  classification: z.enum(Object.keys(BOOK_TYPES) as [BookType, ...BookType[]]).nullable(),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
export type MetadataChange = z.infer<typeof metadataChangeSchema>;
export const accountDirectorySchema = z.array(z.object({
  id: idSchema, name: z.string(), offBudget: z.boolean(), closed: z.boolean(), groupId: idSchema.nullish(),
})).max(10000);
export function eligibility(account: Account | undefined, assetType: string, maps: AccountClassMaps): string | null {
  if (!account) return "The saved Actual account is unavailable";
  if (account.closed) return "The account is closed";
  if (!account.offBudget) return "Assets require an off-budget account";
  const type = ASSET_TYPES[assetType as AssetType];
  if (!type) return "Unknown asset type; settings are read-only";
  if (resolveAccountClass(account.id, account.groupId, maps).accountClass !== type.accountClass) return `Requires the ${type.accountClass} account class (including group inheritance)`;
  return null;
}
export function ownershipAt(asset: Asset, date: string): number | null {
  return [...asset.ownership].filter((p) => p.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.ownershipBps ?? null;
}
