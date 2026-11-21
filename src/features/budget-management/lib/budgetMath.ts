/**
 * Minimal arithmetic expression parser for budget cell inputs.
 *
 * Supports: +, -, *, /, parentheses, integer and decimal literals.
 * No eval — recursive descent only.
 * Result is rounded to the nearest integer (minor units).
 */

type ParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export function parseBudgetExpression(input: string): ParseResult {
  // Commas only group thousands ("12,000" is 12000). A number grouped any
  // other way, such as "1,50", is refused rather than read as 150.
  for (const number of input.match(/[\d.,]+/g) ?? []) {
    if (number.includes(",") && !/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(number)) {
      return { ok: false, error: "Use commas only to group thousands, as in 1,500" };
    }
  }
  const src = input.trim().replace(/,/g, "");
  if (src === "") return { ok: false, error: "Empty expression" };

  try {
    const parser = new ExpressionParser(src);
    const value = parser.parseExpression();
    if (!isFinite(value)) {
      return { ok: false, error: "Result is not a finite number" };
    }
    // Input is in dollars; return minor units (cents).
    return { ok: true, value: Math.round(value * 100) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse error" };
  }
}

// ─── Parser internals ─────────────────────────────────────────────────────────

class ExpressionParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parseExpression(): number {
    let left = this.parseTerm();

    while (this.pos < this.src.length) {
      this.skipWhitespace();
      const ch = this.src[this.pos];
      if (ch === "+") {
        this.pos++;
        left += this.parseTerm();
      } else if (ch === "-") {
        this.pos++;
        left -= this.parseTerm();
      } else {
        break;
      }
    }

    this.skipWhitespace();
    if (this.pos < this.src.length) {
      throw new Error(`Unexpected character: "${this.src[this.pos]}"`);
    }

    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();

    while (this.pos < this.src.length) {
      this.skipWhitespace();
      const ch = this.src[this.pos];
      if (ch === "*") {
        this.pos++;
        left *= this.parseFactor();
      } else if (ch === "/") {
        this.pos++;
        const divisor = this.parseFactor();
        if (divisor === 0) throw new Error("Division by zero");
        left /= divisor;
      } else {
        break;
      }
    }

    return left;
  }

  private parseFactor(): number {
    this.skipWhitespace();

    if (this.pos >= this.src.length) {
      throw new Error("Unexpected end of expression");
    }

    const ch = this.src[this.pos];

    if (ch === "(") {
      this.pos++;
      const value = this.parseInnerExpression();
      this.skipWhitespace();
      if (this.src[this.pos] !== ")") {
        throw new Error("Missing closing parenthesis");
      }
      this.pos++;
      return value;
    }

    if (ch === "-") {
      this.pos++;
      return -this.parseFactor();
    }

    return this.parseNumber();
  }

  /** Like parseExpression but does NOT check for trailing chars (used inside parens). */
  private parseInnerExpression(): number {
    let left = this.parseTerm();

    while (this.pos < this.src.length) {
      this.skipWhitespace();
      const ch = this.src[this.pos];
      if (ch === "+") {
        this.pos++;
        left += this.parseTerm();
      } else if (ch === "-") {
        this.pos++;
        left -= this.parseTerm();
      } else {
        break;
      }
    }

    return left;
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.pos;

    while (
      this.pos < this.src.length &&
      /[\d.]/.test(this.src[this.pos] ?? "")
    ) {
      this.pos++;
    }

    if (this.pos === start) {
      throw new Error(
        `Expected a number at position ${this.pos}, got "${this.src[this.pos]}"`
      );
    }

    const numStr = this.src.slice(start, this.pos);
    const value = parseFloat(numStr);

    if (isNaN(value)) {
      throw new Error(`Invalid number: "${numStr}"`);
    }

    return value;
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] ?? "")) {
      this.pos++;
    }
  }
}
