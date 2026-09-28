const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Normalize semantic characters without changing the source geometry. */
export function normalizePdfText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\u2212\u2010-\u2015\ufe63\uff0d]/g, "-")
    .replace(/[＋﹢]/g, "+")
    .replace(/[﹙（]/g, "(")
    .replace(/[﹚）]/g, ")")
    .replace(/[٫]/g, ".")
    .replace(/[٬]/g, ",")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EASTERN_ARABIC_DIGITS.indexOf(digit)))
    .replace(/(?<!\p{L})([cd])\s*r(?!\p{L})/giu, (_, prefix: string) => `${prefix.toUpperCase()}R`)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A value's shape with its content removed: letters in any script, with their
 * combining marks, become `A`, and digits `9`. Masking only Latin letters let
 * an Arabic or Chinese header word into a saved layout as printed.
 */
export function sourceSafeShape(value: string): string {
  return normalizePdfText(value)
    .replace(/[\p{L}\p{M}]+/gu, "A")
    .replace(/\p{N}+/gu, "9")
    .replace(/\s+/g, " ");
}
