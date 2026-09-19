import Database from "better-sqlite3";
import { DEFAULT_PDF_PARSER_GUIDANCE } from "@/lib/reconciliation/statement/pdf/model";
import { runMigrations } from "./migrations";
import {
  associatePdfDetectionProfile,
  deletePdfDetectionProfile,
  listPdfDetectionProfileCatalog,
  removePdfDetectionAccountAssociation,
  renamePdfDetectionBank,
  renamePdfDetectionProfile,
  savePdfDetectionProfile,
} from "./pdfDetectionProfileRepository";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function profile(name: string, version = 1) {
  return {
    kind: "pdf-layout-v2",
    profile: {
      id: `${name}-${version}`,
      name,
      parserVersion: 2,
      profileVersion: version,
      fingerprint: "safe-layout-shape",
      guidance: DEFAULT_PDF_PARSER_GUIDANCE,
      createdAt: "2026-09-19T00:00:00.000Z",
      supersedesProfileId: null,
      sourcePage: { width: 600, height: 800 },
    },
  };
}

describe("PDF detection profile repository", () => {
  it("shares bank profiles globally while keeping account associations scoped", () => {
    const db = createDb();
    const creditCard = savePdfDetectionProfile(db, {
      budgetSyncId: "budget-a",
      accountId: "card",
      bankName: "HSBC Bank",
      profileName: "Credit card",
      profile: profile("Credit card"),
      assignToAccount: true,
    });
    const checking = savePdfDetectionProfile(db, {
      budgetSyncId: "budget-b",
      accountId: "checking",
      bankName: "HSBC Bank",
      profileName: "Checking",
      profile: profile("Checking"),
      assignToAccount: true,
    });

    const cardCatalog = listPdfDetectionProfileCatalog(db, "budget-a", "card");
    const checkingCatalog = listPdfDetectionProfileCatalog(db, "budget-b", "checking");

    expect(cardCatalog.banks).toHaveLength(1);
    expect(cardCatalog.profiles.map((profile) => profile.name)).toEqual([
      "Checking",
      "Credit card",
    ]);
    expect(cardCatalog.accountProfileId).toBe(creditCard.profile.id);
    expect(checkingCatalog.accountProfileId).toBe(checking.profile.id);
  });

  it("updates a profile in place without changing account assignments", () => {
    const db = createDb();
    const first = savePdfDetectionProfile(db, {
      budgetSyncId: "budget",
      accountId: "account",
      bankName: "HSBC Bank",
      profileName: "Credit card",
      profile: profile("Credit card"),
    });
    const updated = savePdfDetectionProfile(db, {
      budgetSyncId: "budget",
      accountId: "account",
      bankName: "hsbc bank",
      profileName: "credit CARD",
      profile: profile("Credit card", 2),
    });

    expect(updated.profile.id).toBe(first.profile.id);
    expect(updated.profile.profile).toEqual(profile("Credit card", 2));
    expect(listPdfDetectionProfileCatalog(db, "budget", "account").accountProfileId).toBeNull();
  });

  it("assigns an existing profile directly without copying it", () => {
    const db = createDb();
    const saved = savePdfDetectionProfile(db, {
      budgetSyncId: "budget-a",
      accountId: "one",
      bankName: "HSBC Bank",
      profileName: "Checking",
      profile: profile("Checking"),
    });
    associatePdfDetectionProfile(db, {
      budgetSyncId: "budget-b",
      accountId: "two",
      profileId: saved.profile.id,
    });

    expect(listPdfDetectionProfileCatalog(db, "budget-b", "two")).toEqual(expect.objectContaining({
      accountProfileId: saved.profile.id,
    }));

    expect(removePdfDetectionAccountAssociation(db, {
      budgetSyncId: "budget-b",
      accountId: "two",
    })).toBe(true);
    expect(listPdfDetectionProfileCatalog(db, "budget-b", "two").accountProfileId).toBeNull();
  });

  it("renames profiles and removes direct assignments when a profile is deleted", () => {
    const db = createDb();
    const first = savePdfDetectionProfile(db, {
      budgetSyncId: "budget",
      accountId: "account",
      bankName: "HSBC Bank",
      profileName: "Credit card",
      profile: profile("Credit card"),
      assignToAccount: true,
    });
    const second = savePdfDetectionProfile(db, {
      budgetSyncId: "budget",
      accountId: "account",
      bankName: "HSBC Bank",
      profileName: "Checking",
      profile: profile("Checking"),
    });

    expect(renamePdfDetectionBank(db, { bankId: first.bank.id, name: "HSBC" }).name).toBe("HSBC");
    expect(renamePdfDetectionProfile(db, { profileId: second.profile.id, name: "Current account" }))
      .toEqual(expect.objectContaining({ name: "Current account" }));
    expect(deletePdfDetectionProfile(db, first.profile.id)).toBe(true);

    const catalog = listPdfDetectionProfileCatalog(db, "budget", "account");
    expect(catalog.profiles).toHaveLength(1);
    expect(catalog.accountProfileId).toBeNull();
    expect(deletePdfDetectionProfile(db, second.profile.id)).toBe(true);
    expect(listPdfDetectionProfileCatalog(db, "budget", "account")).toEqual(expect.objectContaining({
      banks: [],
      profiles: [],
      accountProfileId: null,
    }));
  });
});
