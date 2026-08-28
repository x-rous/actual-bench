import {
  listArtifactLocations,
  listBackupArtifacts,
  listBackupDestinations,
  listBackupPolicies,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * The recovery sheet (RD-077 / PR-047e).
 *
 * A page of Markdown the user can print, keep in a password manager, or paste
 * into a runbook — written for the situation that actually happens: Bench is
 * gone, the server is gone, and someone is sitting in front of a laptop trying
 * to get their budget back.
 *
 * That constraint decides everything about it. It names real paths and real
 * object keys rather than describing them; it gives commands that work with
 * `unzip`, `sqlite3` and `openssl` rather than through Bench; and it never
 * assumes the reader can reach a running copy of this app, because if they
 * could they would not need the sheet.
 *
 * It contains no secret. It says which passphrase is needed and where the user
 * chose to keep it, never what it is — a recovery sheet ends up in a shared
 * drive far more often than anyone plans for.
 */

export function buildRecoverySheet(db: SqliteDatabase, now: Date = new Date()): string {
  const destinations = listBackupDestinations(db);
  const policies = listBackupPolicies(db);
  const artifacts = listBackupArtifacts(db, { limit: 20 });
  const lines: string[] = [];

  lines.push("# Actual Bench - Backup Recovery Sheet");
  lines.push("");
  lines.push(`Generated ${now.toISOString().replace("T", " ").slice(0, 16)} UTC.`);
  lines.push("");
  lines.push(
    "Keep this with your passwords, not with your backups. It tells you how to get a budget back **without Bench**, which is the situation that matters."
  );
  lines.push("");

  lines.push("## Where the copies are");
  lines.push("");
  if (destinations.length === 0) {
    lines.push("_No destinations are configured._");
  } else {
    for (const destination of destinations) {
      const config = destination.config.data as Record<string, unknown>;
      if (destination.kind === "local") {
        lines.push(`- **${destination.name}** - folder on the Bench server: \`${String(config.path ?? "")}\``);
        lines.push(
          "  - If the server is gone, this folder is gone too unless it was a mounted volume or a network share. Check where that volume actually lives."
        );
      } else {
        const endpoint = config.endpoint ? String(config.endpoint) : "https://s3.amazonaws.com";
        lines.push(
          `- **${destination.name}** - S3-compatible bucket \`${String(config.bucket ?? "")}\`${
            config.prefix ? ` under \`${String(config.prefix)}\`` : ""
          }`
        );
        lines.push(`  - Endpoint: \`${endpoint}\` · Region: \`${String(config.region ?? "us-east-1")}\``);
        lines.push(
          "  - You need the access key for this bucket. Bench does not store it in readable form and it is not printed here."
        );
      }
    }
  }
  lines.push("");

  lines.push("## What is in them");
  lines.push("");
  lines.push(
    "Every backup is stored beside a `.manifest.json` file describing it: what it is, when it was taken, its SHA-256 checksum, and whether it is encrypted. If this sheet is out of date, the manifests are not - read those."
  );
  lines.push("");
  if (artifacts.length > 0) {
    lines.push("Most recent copies Bench knew about:");
    lines.push("");
    lines.push("| Taken | What | Size | Verified | Where |");
    lines.push("|---|---|---|---|---|");
    for (const artifact of artifacts.slice(0, 10)) {
      const locations = listArtifactLocations(db, artifact.id)
        .filter((location) => location.status === "stored")
        .map((location) => {
          const destination = destinations.find((entry) => entry.id === location.destinationId);
          return `${destination?.name ?? "unknown"}: \`${location.objectKey}\``;
        });
      lines.push(
        `| ${artifact.createdAt.slice(0, 16).replace("T", " ")} | ${
          artifact.kind === "budget" ? artifact.sourceBudgetName ?? "Budget" : "Bench settings"
        } | ${formatBytes(artifact.sizeBytes)} | ${
          artifact.verificationStatus === "passed" ? "yes" : "no"
        } | ${locations.join("<br>") || "-"} |`
      );
    }
    lines.push("");
  }

  const encrypted = policies.filter((policy) => policy.encryption === "passphrase");
  if (encrypted.length > 0) {
    lines.push("## Encryption");
    lines.push("");
    lines.push(
      `These rules encrypt their backups: ${encrypted
        .map((policy) => `**${policy.name}**`)
        .join(", ")}. Their files end in \`.enc\` and begin with the ASCII marker \`BENCHBK1\`.`
    );
    lines.push("");
    lines.push(
      "Without the passphrase these files cannot be recovered by anyone, including you. Bench cannot reset it. If you do not know where that passphrase is written down, stop and fix that now - it is the single point of failure in this entire arrangement."
    );
    lines.push("");
    lines.push("The file carries its own parameters, so it can be decrypted with nothing but itself:");
    lines.push("");
    lines.push("```");
    lines.push("bytes  0..7    magic 'BENCHBK1'");
    lines.push("byte   8       format version (1)");
    lines.push("byte   9       salt length (16)");
    lines.push("byte   10      IV length (12)");
    lines.push("byte   11      auth tag length (16)");
    lines.push("then           salt, IV, auth tag, then AES-256-GCM ciphertext");
    lines.push("key            scrypt(passphrase, salt, N=32768, r=8, p=1) → 32 bytes");
    lines.push("```");
    lines.push("");
    lines.push("Decrypting one with Node and nothing else installed:");
    lines.push("");
    lines.push("```js");
    lines.push("const { readFileSync, writeFileSync } = require('node:fs');");
    lines.push("const { scryptSync, createDecipheriv } = require('node:crypto');");
    lines.push("const buf = readFileSync(process.argv[2]);");
    lines.push("const [salt, iv, tag] = [buf.subarray(12, 28), buf.subarray(28, 40), buf.subarray(40, 56)];");
    lines.push(
      "const key = scryptSync(process.argv[3].normalize('NFKC'), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 67108864 });"
    );
    lines.push("const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);");
    lines.push(
      "writeFileSync(process.argv[4], Buffer.concat([d.update(buf.subarray(56)), d.final()]));"
    );
    lines.push("```");
    lines.push("");
  }

  lines.push("## Getting a budget back");
  lines.push("");
  lines.push("1. Copy the `.zip` you want off the destination (decrypt it first if it ends in `.enc`).");
  lines.push(
    "2. Check it is intact: `sha256sum yourfile.zip` should match `checksumSha256` in the manifest beside it - or `plaintextChecksumSha256` if it was encrypted."
  );
  lines.push(
    "3. In Actual Budget, choose **Import file → Actual**, and pick the ZIP. Actual creates a *new* budget file from it; your existing budgets are untouched."
  );
  lines.push("");
  lines.push(
    "There is nothing Bench-specific about that ZIP - it is exactly what Actual's own export produces, so Actual can open it whether or not Bench still exists. That is the point."
  );
  lines.push("");
  lines.push("If you only want to look inside one without importing it:");
  lines.push("");
  lines.push("```sh");
  lines.push("unzip -o yourfile.zip -d restored/");
  lines.push("sqlite3 restored/db.sqlite 'PRAGMA integrity_check;'");
  lines.push("sqlite3 restored/db.sqlite 'SELECT COUNT(*) FROM transactions;'");
  lines.push("```");
  lines.push("");

  lines.push("## Getting Bench's own settings back");
  lines.push("");
  lines.push(
    "Copies marked *Bench settings* are the metadata database: sync rules, mappings, reconciliation sessions, automations and cleanup decisions. Restore it by stopping Bench, putting the file where `ACTUAL_BENCH_DB_PATH` points (default `/data/actual-bench.sqlite`), and starting it again."
  );
  lines.push("");
  lines.push(
    "It holds sealed credentials that only open with the same `SYNC_VAULT_KEY`. Restoring it onto a server with a different key gives you back every rule but no stored credentials, and you will be asked to enter them again."
  );
  lines.push("");

  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
