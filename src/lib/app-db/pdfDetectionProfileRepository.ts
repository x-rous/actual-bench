/**
 * Global, privacy-safe PDF statement detection profiles.
 *
 * Profiles store declarative parser guidance only. Uploaded PDFs, extracted
 * statement text, account names, and credentials never enter these tables.
 */

import { generateId } from "@/lib/uuid";
import { sanitizePdfLayoutProfileEnvelope } from "@/lib/reconciliation/statement/pdf/profiles";
import { AppDbValidationError } from "./errors";
import type { SqliteDatabase } from "./types";

export type PdfDetectionBankRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PdfDetectionProfileRecord = {
  id: string;
  bankId: string;
  name: string;
  profile: unknown;
  createdAt: string;
  updatedAt: string;
};

export type PdfDetectionProfileCatalog = {
  banks: PdfDetectionBankRecord[];
  profiles: PdfDetectionProfileRecord[];
  accountProfileId: string | null;
};

type BankRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  bank_id: string;
  name: string;
  profile_json: string;
  created_at: string;
  updated_at: string;
};

function requiredText(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError(`PDF detection ${field} is required`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new AppDbValidationError(`PDF detection ${field} must be ${max} characters or fewer`);
  }
  return text;
}

function serializedProfile(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppDbValidationError("PDF detection profile data is required");
  }
  try {
    return JSON.stringify(value);
  } catch {
    throw new AppDbValidationError("PDF detection profile data must be serializable");
  }
}

function bankRecord(row: BankRow): PdfDetectionBankRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function profileRecord(row: ProfileRow): PdfDetectionProfileRecord {
  let profile: unknown = null;
  try {
    profile = JSON.parse(row.profile_json);
  } catch {
    // A corrupt profile is returned as null so callers can skip it without
    // making the entire global catalog unavailable.
  }
  return {
    id: row.id,
    bankId: row.bank_id,
    name: row.name,
    profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPdfDetectionProfileCatalog(
  db: SqliteDatabase,
  budgetSyncId?: string,
  accountId?: string
): PdfDetectionProfileCatalog {
  const banks = db
    .prepare("SELECT * FROM pdf_detection_banks ORDER BY name COLLATE NOCASE")
    .all<BankRow>()
    .map(bankRecord);
  const profiles = db
    .prepare("SELECT * FROM pdf_detection_profiles ORDER BY bank_id, name COLLATE NOCASE")
    .all<ProfileRow>()
    .map(profileRecord);
  const association = budgetSyncId && accountId
    ? db.prepare(
        `SELECT profile_id
           FROM pdf_detection_account_profiles
          WHERE budget_sync_id = ? AND account_id = ?`
      ).get<{ profile_id: string }>(budgetSyncId, accountId)
    : undefined;
  return {
    banks,
    profiles,
    accountProfileId: association?.profile_id ?? null,
  };
}

export function savePdfDetectionProfile(
  db: SqliteDatabase,
  input: {
    budgetSyncId: string;
    accountId: string;
    bankName: string;
    profileName: string;
    profile: unknown;
    assignToAccount?: boolean;
  }
): { bank: PdfDetectionBankRecord; profile: PdfDetectionProfileRecord } {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const accountId = requiredText(input.accountId, "account");
  const bankName = requiredText(input.bankName, "bank name");
  const profileName = requiredText(input.profileName, "profile name");
  const safeProfile = sanitizePdfLayoutProfileEnvelope(input.profile);
  if (!safeProfile) {
    throw new AppDbValidationError("PDF detection profile data is invalid");
  }
  if (safeProfile.profile.name.localeCompare(profileName, undefined, { sensitivity: "accent" }) !== 0) {
    throw new AppDbValidationError("PDF detection profile name does not match its saved name");
  }
  const profileJson = serializedProfile(safeProfile);
  const timestamp = new Date().toISOString();

  return db.transaction(() => {
    let bank = db.prepare(
      "SELECT * FROM pdf_detection_banks WHERE name = ? COLLATE NOCASE"
    ).get<BankRow>(bankName);
    if (!bank) {
      bank = {
        id: generateId(),
        name: bankName,
        created_at: timestamp,
        updated_at: timestamp,
      };
      db.prepare(
        `INSERT INTO pdf_detection_banks
           (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      ).run(bank.id, bank.name, timestamp, timestamp);
    }

    let profile = db.prepare(
      "SELECT * FROM pdf_detection_profiles WHERE bank_id = ? AND name = ? COLLATE NOCASE"
    ).get<ProfileRow>(bank.id, profileName);
    if (profile) {
      db.prepare(
        "UPDATE pdf_detection_profiles SET profile_json = ?, updated_at = ? WHERE id = ?"
      ).run(profileJson, timestamp, profile.id);
      profile = { ...profile, profile_json: profileJson, updated_at: timestamp };
    } else {
      profile = {
        id: generateId(),
        bank_id: bank.id,
        name: profileName,
        profile_json: profileJson,
        created_at: timestamp,
        updated_at: timestamp,
      };
      db.prepare(
        `INSERT INTO pdf_detection_profiles
           (id, bank_id, name, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(profile.id, profile.bank_id, profile.name, profile.profile_json, timestamp, timestamp);
    }

    if (input.assignToAccount) {
      upsertAccountAssociation(db, {
        budgetSyncId,
        accountId,
        profileId: profile.id,
        timestamp,
      });
    }

    return { bank: bankRecord(bank), profile: profileRecord(profile) };
  })();
}

export function associatePdfDetectionProfile(
  db: SqliteDatabase,
  input: { budgetSyncId: string; accountId: string; profileId: string }
): void {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const accountId = requiredText(input.accountId, "account");
  const profileId = requiredText(input.profileId, "profile");
  const profile = db.prepare(
    "SELECT id FROM pdf_detection_profiles WHERE id = ?"
  ).get<{ id: string }>(profileId);
  if (!profile) throw new AppDbValidationError("PDF detection profile was not found");
  upsertAccountAssociation(db, {
    budgetSyncId,
    accountId,
    profileId,
    timestamp: new Date().toISOString(),
  });
}

export function removePdfDetectionAccountAssociation(
  db: SqliteDatabase,
  input: { budgetSyncId: string; accountId: string }
): boolean {
  const budgetSyncId = requiredText(input.budgetSyncId, "budget");
  const accountId = requiredText(input.accountId, "account");
  return db.prepare(
    "DELETE FROM pdf_detection_account_profiles WHERE budget_sync_id = ? AND account_id = ?"
  ).run(budgetSyncId, accountId).changes > 0;
}

export function renamePdfDetectionBank(
  db: SqliteDatabase,
  input: { bankId: string; name: string }
): PdfDetectionBankRecord {
  const bankId = requiredText(input.bankId, "bank");
  const name = requiredText(input.name, "bank name");
  const conflict = db.prepare(
    "SELECT id FROM pdf_detection_banks WHERE name = ? COLLATE NOCASE AND id <> ?"
  ).get<{ id: string }>(name, bankId);
  if (conflict) throw new AppDbValidationError("A PDF detection bank with that name already exists");
  const timestamp = new Date().toISOString();
  const result = db.prepare(
    "UPDATE pdf_detection_banks SET name = ?, updated_at = ? WHERE id = ?"
  ).run(name, timestamp, bankId);
  if (!result.changes) throw new AppDbValidationError("PDF detection bank was not found");
  return bankRecord(db.prepare("SELECT * FROM pdf_detection_banks WHERE id = ?").get<BankRow>(bankId)!);
}

export function renamePdfDetectionProfile(
  db: SqliteDatabase,
  input: { profileId: string; name: string }
): PdfDetectionProfileRecord {
  const profileId = requiredText(input.profileId, "profile");
  const name = requiredText(input.name, "profile name");
  const row = db.prepare("SELECT * FROM pdf_detection_profiles WHERE id = ?").get<ProfileRow>(profileId);
  if (!row) throw new AppDbValidationError("PDF detection profile was not found");
  const conflict = db.prepare(
    `SELECT id FROM pdf_detection_profiles
      WHERE bank_id = ? AND name = ? COLLATE NOCASE AND id <> ?`
  ).get<{ id: string }>(row.bank_id, name, profileId);
  if (conflict) throw new AppDbValidationError("That bank already has a profile with this name");
  let storedProfile: unknown;
  try {
    storedProfile = JSON.parse(row.profile_json) as unknown;
  } catch {
    throw new AppDbValidationError("PDF detection profile data is invalid");
  }
  const safeProfile = sanitizePdfLayoutProfileEnvelope(storedProfile);
  if (!safeProfile) throw new AppDbValidationError("PDF detection profile data is invalid");
  const renamed = {
    ...safeProfile,
    profile: { ...safeProfile.profile, name },
    ...(safeProfile.history
      ? { history: safeProfile.history.map((profile) => ({ ...profile, name })) }
      : {}),
  };
  const profileJson = serializedProfile(renamed);
  const timestamp = new Date().toISOString();
  db.prepare(
    `UPDATE pdf_detection_profiles
        SET name = ?, profile_json = ?, updated_at = ?
      WHERE id = ?`
  ).run(name, profileJson, timestamp, profileId);
  return profileRecord({
    ...row,
    name,
    profile_json: profileJson,
    updated_at: timestamp,
  });
}

export function deletePdfDetectionProfile(db: SqliteDatabase, profileIdValue: string): boolean {
  const profileId = requiredText(profileIdValue, "profile");
  return db.transaction(() => {
    const profile = db.prepare(
      "SELECT id, bank_id FROM pdf_detection_profiles WHERE id = ?"
    ).get<{ id: string; bank_id: string }>(profileId);
    if (!profile) return false;
    db.prepare("DELETE FROM pdf_detection_profiles WHERE id = ?").run(profileId);
    const remaining = db.prepare(
      `SELECT 1 AS present FROM pdf_detection_profiles
        WHERE bank_id = ?
        LIMIT 1`
    ).get<{ present: number }>(profile.bank_id);
    if (!remaining) {
      db.prepare("DELETE FROM pdf_detection_banks WHERE id = ?").run(profile.bank_id);
    }
    return true;
  })();
}

function upsertAccountAssociation(
  db: SqliteDatabase,
  input: {
    budgetSyncId: string;
    accountId: string;
    profileId: string;
    timestamp: string;
  }
): void {
  db.prepare(
    `INSERT INTO pdf_detection_account_profiles
       (budget_sync_id, account_id, profile_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(budget_sync_id, account_id) DO UPDATE SET
       profile_id = excluded.profile_id,
       updated_at = excluded.updated_at`
  ).run(
    input.budgetSyncId,
    input.accountId,
    input.profileId,
    input.timestamp
  );
}
