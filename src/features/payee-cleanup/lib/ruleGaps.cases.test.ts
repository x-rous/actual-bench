import { findRuleGaps } from "./ruleGaps";
import type { ImportedTextRow } from "./ruleCandidates";
import type { PayeeCleanupCandidate } from "../types";

/**
 * Real payees from a real budget, scanned together.
 *
 * Every one of these was reported as a bad suggestion, and each exposed a
 * different way of picking the wrong words. They are kept as one scan rather
 * than a case each because two of the signals — how widely a word is shared, and
 * therefore whether it names a merchant or is just scenery — only exist across a
 * whole budget. Tested one at a time, `DUBAI` looks as distinctive as `EMIRATES`.
 */

const CASES: Record<string, [string, number][]> = {
  Grammarly: [
    ["#2025-06 GRAMMARLY CO*FAMO8QU 8883186146 CA USD144.00", 1],
    ["#2024-06 GRAMMARLY COG4SRUFO 8883186146 CA USD144.00", 1],
    ["#2023-06 GRAMMARLY COKY729VF 8883186146 CA USD144.00", 1],
  ],
  "Green Planet": [
    ["#2024-05 GREEN PLANET DUBAI UAE", 3],
    ["#2026-05 GREEN PLANET", 1],
  ],
  "Mudon Contractor": [
    ["#2025-04 04-0913 TRANSFER AEV05045BA8QKOXS HIB- 497203X773365 La Rosa 497 MUDON IRRIGATION AE750400000552809186001 TTS La Rosa 497 IBAI27985 INTERNET BANKING", 1],
    ["#2025-04 04-0910 TRANSFER AEV03045BA8JRFGG HIB- 715724X729450 La Rosa 3 497 MUDON IRRIGATION AE750400000552809186001 TTS La Rosa 3 497 IBAI19058 INTERNET BANKING", 1],
    ["#2025-03 04-0903 TRANSFER AEV270358I7X4H1C OW IPP RTP PYMT HIB- 787115X732819 La Rosa 497 MUDON IRRIGATION AE750400000552809186001 PIN La Rosa 497 IBAH04037 INTERNET BANKING", 1],
    ["#2023-11 04-0677 TRANSFER AEV271132YUB87NK HIB- 144040X900437 MUDON IRRIGATION AE750400000552809186001 GDS MANAF ABUROUS LA ROSA 3 497 INSTALLATION WORK IBAF01589 INTERNET BANKING", 1],
  ],
  "Reliable Squad": [
    ["#2023-12 04-0690 TRANSFER AEV11123BAVL8NWG HIB- 179410X943831 RELIABLE SQUAD TECHNICAL SERVICES L AE610030012374099820001 GDS RSTS MAN 1223 1205 MANAF ABU ROUS LA ROSA 3 VILLA 497 IBAF50845 INTERNET BANKING", 1],
    ["#2023-12 04-0689 TRANSFER AEV07123BAV8DR5S HIB- 144040X564866 RELIABLE SQUAD TECHNICAL SERVICES L AE610030012374099820001 GDS RSTS MAN 1223 1203 MANAF ABU ROUS IBAB48090 INTERNET BANKING", 1],
    ["#2023-11 04-0678 TRANSFER AEV28113BAUEKPOG HIB- 280X834806 RELIABLE SQUAD TECHNICAL SERVICES L AE610030012374099820001 GDS MANAF ABU ROUS VILLA 497 LA ROSA 3 SPC FLOORING IBAH95869 INTERNET BANKING", 1],
  ],
  "Life Pharmacy": [
    ["#2026-01 LIFE 29 PHY-1264 DUBAI ARE", 1],
    ["#2024-08 1264-LIFE 29 PHY DUBAI ARE", 1],
    ["#2024-06 1264-LIFE 29 PHY DUBAI ARE", 1],
    ["#2023-06 LIFE 29 PHY-1264 Dubai DXB", 1],
    ["#2023-05 (SM-PAY)- LIFE 29 PHY-1264 Dubai DXB", 1],
  ],
  "Cigna ME": [
    ["#2025-03 04-0889 TRANSFER AE1SWIF2506400F3 AER060358I5Y5VLW 1/CIGNA INSURANCE MIDDLE EAST SAL /REF/INS INSURANCE SERVICES /ROC/6850000014138977 YPI408697 OTHER SOURCE", 1],
    ["#2025-02 04-0882 TRANSFER AE1SWIF2505000SH AER200258I4O1UTI 1/CIGNA INSURANCE MIDDLE EAST SAL /REF/INS INSURANCE SERVICES /ROC/6850000014099541 YPI421127 OTHER SOURCE", 1],
    ["#2025-01 04-0869 TRANSFER AE1SWIF2500900QX AER100158I0XATFL 1/CIGNA INSURANCE MIDDLE EAST SAL /REF/INS INSURANCE SERVICES /ROC/6850000013989869 YPI517356 OTHER SOURCE", 1],
  ],
  miniBOUNCE: [
    ["#2025-05 (SM-PAY)- MINI BOUNCE DUBAI 784", 2],
    ["#2025-04 (AP-PAY)- MINI BOUNCE DUBAI 784", 2],
    ["#2025-06 (SM-PAY)- MINI BOUNCE DUBAI 784", 1],
    ["#2025-05 MINI BOUNCE DUBAI DXB", 1],
    ["#2025-04 MINI BOUNCE DUBAI 784", 1],
  ],
  "Level Up Fitness": [
    ["#2025-07 LVL UP FITNESS CTR DUBAI UAE", 2],
    ["#2025-06 (SM-PAY)- LVL UP FITNESS CTR DUBAI UAE", 3],
    ["#2024-11 LVL UP fitness center Dubai DXB", 3],
    ["#2023-02 LVLUP FITNESS DUBAI", 1],
  ],
  "Google Storage": [
    ["#2024-07 Google Storage Mountain View CA SAR10.99", 1],
    ["#2024-06 Google Storage Mountain View CA SAR10.99", 1],
    ["#2024-05 Google Storage Mountain View CA SAR10.99", 1],
  ],
  "Ready Set Go": [
    ["#2024-06 READY SET GO KIDS AMUS DUBAI ARE", 9],
    ["#2024-09 READY SET GO KIDS DUBAI ARE", 5],
    ["#2024-11 READY SET GO KIDS DUBAI ARE", 1],
  ],
  "Emirates Airlines": [
    ["#2024-08 EMIRATES DUBAI ARE", 2],
    ["#2026-08 EMIRATES", 1],
    ["#2025-03 EMIRATES62385176881-2 DUBAI ARE", 1],
  ],
  "Etihad Credit Bureau": [
    ["#API Etihad Credit Bureau", 4],
    ["#2026-05 Etihad Credit Bureau", 1],
    ["-84 IRR (FX rate: #2026-02 ETIHAD CREDIT BUREAU DUBAI UAE)", 1],
  ],
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
    ["Grammarly", "contains GRAMMARLY"],
    // Both imports fell in May, so the date's `05` looked like shared merchant
    // text — which is why hashtag markers are stripped before the core is read.
    ["Green Planet", "contains GREEN PLANET"],
    // The street its invoices mention is shared with other contractors; its own
    // name is not.
    ["Mudon Contractor", "contains MUDON IRRIGATION"],
    // A transfer record is mostly IBAN and reference; four words is enough.
    ["Reliable Squad", "contains RELIABLE SQUAD TECHNICAL SERVICES"],
    // `1264` moves from the front to the middle between imports, so the run that
    // covers every one of them is shorter than the run that covers half.
    ["Life Pharmacy", "contains LIFE 29 PHY"],
    ["Cigna ME", "contains CIGNA INSURANCE MIDDLE EAST"],
    // `PAY` comes from the `(SM-PAY)` channel marker and covers only the imports
    // that carry it.
    ["miniBOUNCE", "contains MINI BOUNCE"],
    // One import written `LVLUP` must not reduce the core to `FITNESS`.
    ["Level Up Fitness", "contains LVL UP FITNESS"],
    // Nothing follows the shared text in any import, so where the merchant ends
    // is unknown and the price must not be treated as part of the name.
    ["Google Storage", "contains GOOGLE STORAGE"],
    // Here something *does* follow it — `AMUS` in one, `DUBAI` in another — so
    // the boundary is evidence and is kept.
    ["Ready Set Go", "contains READY SET GO KIDS"],
    // `EMIRATES62385176881` is a different word from `EMIRATES`, and `DUBAI ARE`
    // closes half the budget's imports.
    ["Emirates Airlines", "contains EMIRATES"],
    ["Etihad Credit Bureau", "contains ETIHAD CREDIT BUREAU"],
  ])("%s → %s", (payee, expected) => {
    expect(conditions.get(payee)).toBe(expected);
  });
});
