import { reduceFully } from "./reduce";

/**
 * Shape-reducer tests. Every case here must reduce from the name **alone**,
 * with no corpus and no vocabulary — that is the definition of a shape rule.
 *
 * Anything that needs to know the institution (a channel wrapper, a city, a
 * bank's "INTERNET BANKING" tag) belongs in `corpusAffixes.test.ts` instead,
 * where it is learned from the payee set rather than hard-coded.
 *
 * The fixtures come from real Australian, UAE and Saudi exports, because
 * invented examples are too tidy to catch anything. They are evidence, not
 * configuration: no reducer knows they exist.
 */

function stem(name: string): string {
  return reduceFully(name).stem;
}

describe("dates", () => {
  it.each([
    ["ACME STORE 12/03/2024", "ACME STORE"],
    ["ACME STORE 2023-09-02", "ACME STORE"],
    ["ACME STORE 06MAR25", "ACME STORE"],
    ["ACME STORE 05MAR2025", "ACME STORE"],
    ["SALARY PAYMENT Oct 2025", "SALARY PAYMENT"],
    ["ACME 1.12.2024", "ACME"],
  ])("%s → %s", (input, expected) => {
    expect(stem(input)).toBe(expected);
  });

  it("takes the labelled form with its label", () => {
    expect(stem("MARKET BOYS Value Date: 12/03/2024")).toBe("MARKET BOYS");
  });

  it("leaves a number that is not a date", () => {
    expect(stem("STUDIO 54")).toContain("STUDIO");
  });
});

describe("times", () => {
  it.each([
    ["ACME STORE 19:40:27", "ACME STORE"],
    ["ACME STORE 09:24", "ACME STORE"],
  ])("%s → %s", (input, expected) => {
    expect(stem(input)).toBe(expected);
  });
});

describe("card numbers", () => {
  it.each([
    ["ACME STORE Card xx9166", "ACME STORE"],
    ["ACME STORE xx4534", "ACME STORE"],
    ["ACME STORE ****1234", "ACME STORE"],
    ["ACME STORE Card Ending with 5070", "ACME STORE"],
    ["ACME STORE CARD NO: ***132", "ACME STORE"],
  ])("%s → %s", (input, expected) => {
    expect(stem(input)).toBe(expected);
  });

  it("removes the CARD label with the number, leaving no stray word", () => {
    // Leaving a bare "Card" behind blocks later reducers from reaching the end
    // of the name.
    expect(stem("MARKET BOYS Card xx4534")).not.toContain("CARD");
  });
});

describe("reference and authorization numbers", () => {
  it.each([
    ["PAY PROTECT 393160543", "PAY PROTECT"],
    ["ACME STORE A88898560", "ACME STORE"],
    ["ACME STORE IBAG41116", "ACME STORE"],
    ["ACME STORE REF A896-13013", "ACME STORE"],
    ["ACME STORE SEQ:00001181", "ACME STORE"],
    ["ACME STORE HIB- 97340X909334", "ACME STORE"],
  ])("%s → %s", (input, expected) => {
    expect(stem(input)).toBe(expected);
  });

  it("keeps an account number that identifies the counterparty", () => {
    // No single part of `030-176408-001` is long enough to be a reference, and
    // it is the only thing distinguishing one transfer from another.
    expect(stem("TRANSFER FROM 030-176408-001 IBAG41116")).toBe(
      "TRANSFER FROM 030 176408 001"
    );
  });

  it("keeps a merchant name that merely contains digits", () => {
    expect(stem("7 ELEVEN")).toBe("7 ELEVEN");
    expect(stem("CARREFOUR2")).toBe("CARREFOUR2");
  });
});

describe("store and terminal numbers", () => {
  it.each([
    ["COLES 0559", "COLES"],
    ["WOOLWORTHS 0183", "WOOLWORTHS"],
    ["ENOC SITE 1092", "ENOC SITE"],
  ])("%s → %s", (input, expected) => {
    expect(stem(input)).toBe(expected);
  });

  it("never reduces a purely numeric name to nothing", () => {
    expect(stem("12345").length).toBeGreaterThan(0);
  });
});

describe("the statement tail", () => {
  it("removes the whole record when the merchant leads it", () => {
    expect(
      stem("COLES 0559 02MAR25 ATMA896 19:40:27 0640     VISA        AUD COLES 0559 647986 MELBOURNE    AU A88898560 ATM")
    ).toBe("COLES");
  });

  it("handles a merchant with punctuation", () => {
    expect(
      stem("M, O & F PTY. LTD. 01MAR25 ATMA896 11:48:22 0640     VISA        AUD M, O & F PTY. LTD. 564633 Melbourne    AU A88839934 ATM")
    ).toBe("M O F");
  });

  it("does not fire when the record starts with the date", () => {
    // Nothing precedes the date, so there is no merchant to keep. The narrower
    // reducers take what they can rather than erasing the name.
    const result = stem("31OCT25 ATMA896 15:22:13 0640 VISA AUD APPLE.COM/BILL 428592 SYDNEY AU");
    expect(result).toContain("APPLE");
  });
});

describe("processor prefixes", () => {
  it("strips a short abbreviation before a star", () => {
    expect(stem("SQ *BANGKOKSQUARE")).toBe("BANGKOKSQUARE");
    expect(stem("ZLR*Schnitz")).toBe("SCHNITZ");
  });

  it("keeps a four-letter word before a star, because that is a merchant", () => {
    // `UBER *TRIP` must not become `TRIP`. Processor tags are terse; merchant
    // names are not.
    expect(stem("UBER *TRIP")).toBe("UBER TRIP");
  });
});

describe("web addresses", () => {
  it("removes a trailing address appended to a merchant", () => {
    expect(stem("UBER *TRIP HELP.UBER.COM")).toBe("UBER TRIP");
  });

  it("keeps a domain that IS the merchant", () => {
    expect(stem("Amazon.ae")).toBe("AMAZON AE");
    expect(stem("talabat.com")).toBe("TALABAT COM");
  });
});

describe("exchange-rate fragments", () => {
  it.each([
    ["ADVANCE CAR RENTAL AUD/AED .427637511", "ADVANCE CAR RENTAL"],
    ["TRANSFER FX SAR 36147.46 AT 0.9869742", "TRANSFER"],
  ])("%s → %s", (input, expected) => {
    expect(stem(input)).toBe(expected);
  });
});

describe("card networks and terminals", () => {
  it("removes standalone network and terminal tokens", () => {
    expect(stem("ACME STORE VISA ATMA896")).toBe("ACME STORE");
  });
});

describe("safety", () => {
  it("leaves an already-clean payee completely untouched", () => {
    for (const name of ["Woolworths", "Netflix", "McDonald's", "IKEA", "Bath & Body Works"]) {
      expect(reduceFully(name).steps).toHaveLength(0);
    }
  });

  it("never reduces a name to nothing", () => {
    for (const name of ["UAE", "784", "ATM", "VISA", "0640", "12/03/2024"]) {
      expect(reduceFully(name).stem.length).toBeGreaterThan(0);
    }
  });

  it("keeps a merchant whose name begins with a wrapper-ish word", () => {
    expect(stem("CARD FACTORY")).toBe("CARD FACTORY");
  });

  it("reduces stacked noise in one pass", () => {
    // Five classes at once: legal suffix, card number and date are all shape
    // rules; the city and country are left for the corpus to identify.
    expect(stem("MARKET BOYS PTY LTD Card xx4534 Value Date: 12/03/2024")).toBe(
      "MARKET BOYS"
    );
  });

  it("reports every step it took, so the result is explainable", () => {
    const result = reduceFully("MARKET BOYS PTY LTD Card xx4534 Value Date: 12/03/2024");
    const ids = result.steps.map((s) => s.id);
    expect(ids).toContain("card-number");
    expect(ids).toContain("legal-suffix");
    expect(result.steps.every((s) => s.removed.length > 0)).toBe(true);
  });
});
