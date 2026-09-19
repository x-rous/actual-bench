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

export function sourceSafeShape(value: string): string {
  return normalizePdfText(value)
    .replace(/[A-Za-z]+/g, "A")
    .replace(/\d+/g, "9")
    .replace(/\s+/g, " ");
}
