import { findRuleGaps } from "./ruleGaps";
import { analyzeFutureResolution } from "./ruleCandidates";
import type { ImportedTextRow } from "./ruleCandidates";
import type { PayeeCleanupCandidate } from "../types";

/**
 * Real payees from a real budget, scanned together.
 *
 * Every one of these was reported as a bad suggestion, and each exposed a
 * different way of picking the wrong words. They are kept as one scan rather
 * than a case each because two of the signals — how widely a word is shared, and
 * therefore whether it names a merchant or is just scenery — only exist across a
 * whole budget. Tested one at a time, `ASHDOWN` looks as distinctive as `ATLANTIS`.
 */

const CASES: Record<string, [string, number][]> = {
  Wordcraft: [
    ["#2025-06 WORDCRAFT CO*FAMO8QU 5550117420 CA USD144.00", 1],
    ["#2024-06 WORDCRAFT COG4SRUFO 5550117420 CA USD144.00", 1],
    ["#2023-06 WORDCRAFT COKY729VF 5550117420 CA USD144.00", 1],
  ],
  "Verde Garden": [
    ["#2024-05 VERDE GARDEN ASHDOWN UAE", 3],
    ["#2026-05 VERDE GARDEN", 1],
  ],
  "Novara Contractor": [
    ["#2025-04 04-0913 TRANSFER AEV05045BA8QKOXS HIB- 497203X773365 Oak Ridge 497 NOVARA IRRIGATION AE900000111122223333444 TTS Oak Ridge 497 IBAI27985 INTERNET BANKING", 1],
    ["#2025-04 04-0910 TRANSFER AEV03045BA8JRFGG HIB- 715724X729450 Oak Ridge 3 497 NOVARA IRRIGATION AE900000111122223333444 TTS Oak Ridge 3 497 IBAI19058 INTERNET BANKING", 1],
    ["#2025-03 04-0903 TRANSFER AEV270358I7X4H1C OW IPP RTP PYMT HIB- 787115X732819 Oak Ridge 497 NOVARA IRRIGATION AE900000111122223333444 PIN Oak Ridge 497 IBAH04037 INTERNET BANKING", 1],
    ["#2023-11 04-0677 TRANSFER AEV271132YUB87NK HIB- 144040X900437 NOVARA IRRIGATION AE900000111122223333444 GDS SAMPLE CUSTOMER OAK RIDGE 3 497 INSTALLATION WORK IBAF01589 INTERNET BANKING", 1],
  ],
  "Primefix Building": [
    ["#2023-12 04-0690 TRANSFER AEV11123BAVL8NWG HIB- 179410X943831 PRIMEFIX BUILDING TECHNICAL SERVICES L AE900000555566667777888 GDS PBTS REF 1223 1205 SAMPLE CUSTOMER OAK RIDGE 3 VILLA 312 IBAF50845 INTERNET BANKING", 1],
    ["#2023-12 04-0689 TRANSFER AEV07123BAV8DR5S HIB- 144040X564866 PRIMEFIX BUILDING TECHNICAL SERVICES L AE900000555566667777888 GDS PBTS REF 1223 1203 SAMPLE CUSTOMER IBAB48090 INTERNET BANKING", 1],
    ["#2023-11 04-0678 TRANSFER AEV28113BAUEKPOG HIB- 280X834806 PRIMEFIX BUILDING TECHNICAL SERVICES L AE900000555566667777888 GDS SAMPLE CUSTOMER VILLA 497 OAK RIDGE 3 SPC FLOORING IBAH95869 INTERNET BANKING", 1],
  ],
  "Medix Pharmacy": [
    ["#2026-01 MEDIX 29 PHY-1264 ASHDOWN ARE", 1],
    ["#2024-08 1264-MEDIX 29 PHY ASHDOWN ARE", 1],
    ["#2024-06 1264-MEDIX 29 PHY ASHDOWN ARE", 1],
    ["#2023-06 MEDIX 29 PHY-1264 Ashdown DXB", 1],
    ["#2023-05 (SM-PAY)- MEDIX 29 PHY-1264 Ashdown DXB", 1],
  ],
  "Orion ME": [
    ["#2025-03 04-0889 TRANSFER AE1SWIF2506400F3 AER060358I5Y5VLW 1/ORION INSURANCE MIDDLE EAST SAL /REF/INS INSURANCE SERVICES /ROC/6850000014138977 YPI408697 OTHER SOURCE", 1],
    ["#2025-02 04-0882 TRANSFER AE1SWIF2505000SH AER200258I4O1UTI 1/ORION INSURANCE MIDDLE EAST SAL /REF/INS INSURANCE SERVICES /ROC/6850000014099541 YPI421127 OTHER SOURCE", 1],
    ["#2025-01 04-0869 TRANSFER AE1SWIF2500900QX AER100158I0XATFL 1/ORION INSURANCE MIDDLE EAST SAL /REF/INS INSURANCE SERVICES /ROC/6850000013989869 YPI517356 OTHER SOURCE", 1],
  ],
  jumpHOUSE: [
    ["#2025-05 (SM-PAY)- JUMP HOUSE ASHDOWN 784", 2],
    ["#2025-04 (AP-PAY)- JUMP HOUSE ASHDOWN 784", 2],
    ["#2025-06 (SM-PAY)- JUMP HOUSE ASHDOWN 784", 1],
    ["#2025-05 JUMP HOUSE ASHDOWN DXB", 1],
    ["#2025-04 JUMP HOUSE ASHDOWN 784", 1],
  ],
  "Gym Go Fitness": [
    ["#2025-07 GYM GO FITNESS CTR ASHDOWN UAE", 2],
    ["#2025-06 (SM-PAY)- GYM GO FITNESS CTR ASHDOWN UAE", 3],
    ["#2024-11 GYM GO fitness center Ashdown DXB", 3],
    ["#2023-02 GYMGO FITNESS ASHDOWN", 1],
  ],
  "Nimbus Storage": [
    ["#2024-07 Nimbus Storage Spring Valley CA USD10.99", 1],
    ["#2024-06 Nimbus Storage Spring Valley CA USD10.99", 1],
    ["#2024-05 Nimbus Storage Spring Valley CA USD10.99", 1],
  ],
  "Sprint Set Go": [
    ["#2024-06 SPRINT SET GO KIDS AMUS ASHDOWN ARE", 9],
    ["#2024-09 SPRINT SET GO KIDS ASHDOWN ARE", 5],
    ["#2024-11 SPRINT SET GO KIDS ASHDOWN ARE", 1],
  ],
  "Atlantis Airways": [
    ["#2024-08 ATLANTIS ASHDOWN ARE", 2],
    ["#2026-08 ATLANTIS", 1],
    ["#2025-03 ATLANTIS71234567890-2 ASHDOWN ARE", 1],
  ],
  "Summit Credit Bureau": [
    ["#API Summit Credit Bureau", 4],
    ["#2026-05 Summit Credit Bureau", 1],
    ["-84 IRR (FX rate: #2026-02 SUMMIT CREDIT BUREAU ASHDOWN UAE)", 1],
  ],
  // The second batch, reported once markers were being stripped from the core
  // but not from the exact list — so each of these produced a rule keyed to a
  // single month, which can never fire again.
  "Parque Hypermarket": [["#2023-07 Parque Retail Co WESTON", 2]],
  BurgerBarn: [
    ["#2023-09 BB Kestrel BELMONT", 7], ["#2023-10 BB Kestrel BELMONT", 5],
    ["#2023-10 BB 8260 BELMONT", 3], ["BurgerBarnPrHaven", 1],
    ["#2026-03 BURGERBARN CROSSING ASHDOWN 784", 1],
  ],
  "TOP Fashion": [
    ["#API TOP", 2], ["#2026-06 TOP ASHDOWN 784", 2],
    ["-112 IRR (FX rate: #2026-04 TOP ASHDOWN 784)", 1],
  ],
  "Dr. Elms Valley Dental Clinic": [["#API ELMS VALLEY DENTAL SURG", 2]],
  MealExpress: [["#API MEALEXPRESS LLC", 2]],
  "Harbour Markets": [["#2024-02 HARBOUR MARKETS BELMONT", 6], ["#2024-05 HARBOUR MARKETS BELMONT", 4]],
  Marketway: [["#2024-02 MARKETWAY ASHDOWN ARE", 6], ["#2024-05 MARKETWAY BELMONT", 4]],
  Penlight: [["#2024-02 PENLIGHT BOOKSTORE BELMONT", 6], ["#2024-06 PENLIGHT BOOKSTORE ASHDOWN", 4]],

};


function scan() {
  const candidates: PayeeCleanupCandidate[] = [];
  const rows: ImportedTextRow[] = [];
  const transactionCounts = new Map<string, number>();

  for (const [name, texts] of Object.entries(CASES)) {
    candidates.push({
      id: name,
      name,
      metadata: {
        id: name,
        favorite: false,
        learnCategories: true,
        tombstone: false,
        transferAccountId: null,
      },
    });
    transactionCounts.set(
      name,
      texts.reduce((sum, [, n]) => sum + n, 0)
    );
    for (const [text, n] of texts) {
      rows.push({
        field: "notes",
        text,
        payeeId: name,
        payeeName: null,
        transactionCount: n,
      });
    }
  }

  const gaps = findRuleGaps({
    candidates,
    rows,
    rules: [],
    transactionCounts,
    clusteredPayeeIds: new Set(),
  });

  const conditions = new Map<string, string>();
  for (const gap of gaps) {
    const p = gap.proposal;
    conditions.set(
      gap.payee.name,
      p.shape === "one-of"
        ? `oneOf ${JSON.stringify(p.texts)}`
        : `${p.candidate.op} ${p.candidate.value}`
    );
  }
  return conditions;
}

describe("what a real budget should produce", () => {
  const conditions = scan();

  it.each([
    // A phone number is stable across every statement line, and was winning on
    // length. The merchant's own name is one word and was losing.
    ["Wordcraft", "contains WORDCRAFT"],
    // Both imports fell in May, so the date's `05` looked like shared merchant
    // text — which is why hashtag markers are stripped before the core is read.
    ["Verde Garden", "contains VERDE GARDEN"],
    // The street its invoices mention is shared with other contractors; its own
    // name is not.
    ["Novara Contractor", "contains NOVARA IRRIGATION"],
    // A transfer record is mostly IBAN and reference; four words is enough.
    ["Primefix Building", "contains PRIMEFIX BUILDING TECHNICAL SERVICES"],
    // `1264` moves from the front to the middle between imports, so the run that
    // covers every one of them is shorter than the run that covers half.
    ["Medix Pharmacy", "contains MEDIX 29 PHY"],
    ["Orion ME", "contains ORION INSURANCE MIDDLE EAST"],
    // `PAY` comes from the `(SM-PAY)` channel marker and covers only the imports
    // that carry it.
    ["jumpHOUSE", "contains JUMP HOUSE"],
    // One import written `GYMGO` must not reduce the core to `FITNESS`.
    ["Gym Go Fitness", "contains GYM GO FITNESS"],
    // Nothing follows the shared text in any import, so where the merchant ends
    // is unknown and the price must not be treated as part of the name.
    ["Nimbus Storage", "contains NIMBUS STORAGE"],
    // Here something *does* follow it — `AMUS` in one, `ASHDOWN` in another — so
    // the boundary is evidence and is kept.
    ["Sprint Set Go", "contains SPRINT SET GO KIDS"],
    // `ATLANTIS71234567890` is a different word from `ATLANTIS`, and `ASHDOWN ARE`
    // closes half the budget's imports.
    ["Atlantis Airways", "contains ATLANTIS"],
    ["Summit Credit Bureau", "contains SUMMIT CREDIT BUREAU"],
    // A date marker means the text varies, whatever is left once it is stripped,
    // so a list of dated strings is never the answer — each of these produced a
    // rule keyed to one month.
    ["Parque Hypermarket", "contains PARQUE RETAIL"],
    ["BurgerBarn", "contains BB KESTREL"],
    ["TOP Fashion", "contains TOP ASHDOWN"],
    ["Dr. Elms Valley Dental Clinic", "contains ELMS VALLEY"],
    ["MealExpress", "contains MEALEXPRESS"],
    // Scenery, present only so the cities above read as cities.
    ["Harbour Markets", "contains HARBOUR MARKETS"],
    ["Marketway", "contains MARKETWAY"],
    ["Penlight", "contains PENLIGHT BOOKSTORE"],
  ])("%s → %s", (payee, expected) => {
    expect(conditions.get(payee)).toBe(expected);
  });
});

describe("both halves of cleanup answer the same way", () => {
  it("proposes the same condition whether it comes from a merge or a rule gap", () => {
    // The two used different derivations, so one budget produced two shaped
    // rules depending on which tab happened to propose them — and only one of
    // them knew that a date is not a merchant.
    const texts = CASES["Gym Go Fitness"];
    const rows: ImportedTextRow[] = texts.map(([text, n]) => ({
      field: "notes",
      text,
      payeeId: "p1",
      payeeName: null,
      transactionCount: n,
    }));

    const fromMerge = analyzeFutureResolution({
      stem: "GYM GO FITNESS CTR",
      finalName: "Gym Go Fitness",
      members: [
        {
          id: "p1",
          name: "Gym Go Fitness",
          metadata: {
            id: "p1",
            favorite: false,
            learnCategories: true,
            tombstone: false,
            transferAccountId: null,
          },
        },
      ],
      rows,
      rules: [],
    });

    const fromGap = scan().get("Gym Go Fitness");

    expect(fromMerge.recommended?.candidate.op).toBe("contains");
    expect(fromMerge.recommended?.candidate.value).toBe("GYM GO FITNESS");
    expect(fromGap).toBe("contains GYM GO FITNESS");
  });
});
