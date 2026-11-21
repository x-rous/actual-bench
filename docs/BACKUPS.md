# Backups

Actual Bench takes verified copies of your budget — and of its own metadata database — on a
schedule, stores them in one or more destinations, and re-checks them so you find out about a bad
backup before you need it rather than after.

The page is two tabs: **Setup** (destinations, then backup rules, then recovery points, each at full width) and **Backups** (the
artifacts that exist, with their readiness banner, filters and detail drawer). Runtime detail on a
rule is deliberately thin and links to Automations rather than restating it.

This document is the operator's view: how it behaves, what it refuses to do, and what to check when
something looks wrong. The user-facing guide is at `docs-site/src/content/docs/user-guide/backups.mdx`.

## What a backup is here

An **artifact** is one thing that was backed up — a budget export, or a copy of Bench's own
`actual-bench.sqlite`. A **location** is one copy of that artifact in one destination. An artifact in
two destinations is one artifact in two places, and a failure in one of them is not a failure of the
other.

Every artifact is written with a **manifest** (`<object-key>.manifest.json`) beside it, carrying
everything needed to understand the file with no Bench database available: identity, source budget,
content summary, checksums, encryption parameters, retention tier and the Bench version that wrote
it. The index in the app database is a cache of those manifests, not the record of truth — a
catalogue that lives inside the thing being backed up has a circular dependency at exactly the wrong
moment.

Object keys are human-navigable on purpose:

```
actual-budget/household-budget/2026/2026-08-27T020000-3f9c1ab2.zip
actual-budget/household-budget/2026/2026-08-27T020000-3f9c1ab2.zip.manifest.json
actual-bench/2026/2026-08-27T020000-77b41e05.sqlite
```

`actual-budget/` holds copies of Actual budgets, one folder per budget; `actual-bench/` holds Actual
Bench's own data (its app database). Copies written by earlier versions sit under `budget/` and
`app-db/` and stay there: each copy records its own key, so retention, the weekly check, downloads
and **Find backups** work across both layouts.

The day someone is browsing a destination by hand is the day Bench is not available to help.

## Requirements

| Requirement | Why |
|---|---|
| **HTTP API mode** for the source budget | A scheduled backup runs with no browser. Direct mode's engine lives in the browser, so there is nothing on the server to export from. |
| **An enrolled connection** | A scheduled backup runs with no browser, so the server needs the budget's API key. Enrol from the backup rule dialog itself, or from Automations → Connections. |
| **An unlocked vault** | Enrolled credentials, S3 access keys and a stored encryption passphrase are sealed with Bench's vault key, generated on first start. While the vault is locked, Bench refuses to store any of them rather than writing them in the clear. |
| A writable destination | A folder path on the server, or an S3-compatible bucket. |

Backing up **only** Actual Bench's own data (`contents: app-db`) needs none of the above beyond a
destination — it is a local `VACUUM INTO`.

## Destinations

### Local path

Any absolute path the server can write to. Bench creates it if missing, and grades its checks:

- **Refused**: a relative path, a path that is a file, a path it cannot write to, and the directory
  holding Bench's own database (backups must not intermingle with it).
- **Warned**: the same device as Bench's data (good against mistakes, useless against losing the
  disk), and a volume low on space.

Writes go to a temporary file that is flushed to disk (`fsync`) and then renamed into place, and
the folder (plus the parent of any folder the write created) is synced after the rename, so a
partly-written archive never looks like a complete one, even after a power cut. A directory sync
that fails with an I/O error fails the write; a filesystem that does not support one is tolerated. Temp files a stopped
run left behind are swept by the weekly scrub.

The folder carries a `.bench-destination.json` marker naming the destination. Before anything writes,
deletes or calls a copy missing, Bench checks it. If the marker is gone and the newest recorded copy is
not there either, the volume is reported as probably unmounted, and nothing is written into the empty
directory it left behind. (A folder from before the marker existed gets one written the first time a
recorded copy is found in it.)

Once a destination holds copies, its path (or bucket, endpoint and prefix) cannot change: every copy
is recorded by its key inside it. Add a new destination for a new location.

### S3-compatible

Signature V4 is implemented directly over `fetch`; there is no AWS SDK in the image. Verified against
AWS's published GET Object test vector.

- A custom `endpoint` implies **path-style** addressing, which is what MinIO, Garage and most
  self-hosted providers need. Virtual-host style needs wildcard DNS almost nobody configures.
- Works with AWS, MinIO, Backblaze B2, Cloudflare R2, Wasabi and Garage.
- Access keys live in the app database's `credentials` table, sealed with AES-256-GCM under
  the vault key. Nothing outside the backup-secrets module decrypts them, and a destination
  whose credentials cannot be resolved **fails closed** — it never falls back to an
  unauthenticated attempt, which would surface as 403s that look like a broken bucket.

Each request has a timeout until the answer starts (a minute plus time for the body at a slow
uplink's pace). A download is then bounded by progress: it fails only if no data arrives for a
minute, so a large copy on a slow link is not cut off. Network errors, timeouts (including a
download that stalls), 5xx and throttling are retried twice with backoff. A refusal (4xx) is final.

Every save tests the destination by writing real bytes, reading them back, comparing checksums and
deleting the probe. A bucket that refuses deletes is a **warning**: backups still work, only
retention cannot prune.

## The run

1. **Export** the budget from the Actual server, through the same per-server request queue the proxy
   uses. That is not politeness — Actual opens the budget file to serve an export, and a sync
   applying changes at that moment is how a backup gets taken mid-write.
2. **Verify the plaintext**, before anything else touches it.
3. **Encrypt**, if the rule says so.
4. **Fan out** to every destination independently, recording each result on its own. The artifact's
   row is written once the first copy lands, so a run that stored nothing leaves no row behind.

The run honours its deadline and cancel signal: the export, every destination request and the steps
between them stop when it fires.

A run that stored nothing is a failure. A run that stored somewhere but not everywhere, or stored
something that did not verify, is **partial** — reported honestly, but it does **not** count towards
the automation's failure streak. Auto-pausing a backup because one of two destinations is unreachable
would stop the copies that were still working.

Bench's own database is copied with `VACUUM INTO`, which takes SQLite's read lock: the copy is
consistent even if a sync is writing, and there is no WAL to reunite later.

## Verification

Bench reuses Budget Diagnostics' machinery — the same code that powers Budget File Health — pointed
at an artifact instead of a live budget.

| Level | Cost | What it proves |
|---|---|---|
| `archive` | cheap | It is a real ZIP containing what an Actual export contains. |
| `data` | moderate | The database opens, `PRAGMA integrity_check` passes, and the contents can be counted. **Default.** |
| `deep` | slow | The full diagnostic suite, including relationship checks. |

Verification always runs **before** encryption. Verifying ciphertext proves only that bytes survived
a round trip.

### Plausibility, not just readability

Every check above asks whether an artifact is *readable*. One more asks whether it is *plausible*: a
truncated export, or a source that failed to open half its data, produces a perfectly valid archive
containing the wrong amount of budget, and every integrity check passes on it.

So each copy is compared with the last copy of the same budget, under the same rule, that **passed**
(comparing with whatever came last let a second cut-short export match the first and pass). Counts
leave out rows Actual has deleted (`tombstone = 1`); copies counted before this change are not
compared with ones counted after it. A drop of more than 10%
in transactions, any drop in account count, or a copy less than half the previous size fails
verification with a finding naming both numbers. The thresholds are loose on purpose — people do
delete things — and the wording states the change rather than accusing: *"If you deleted them, this
is expected; if not, check the source budget before relying on this copy."*

The copy is still stored and still restorable. It is shown as **Needs review**, not "Damaged": it
opened fine. **Accept this change** on the copy (`PATCH /api/backups/artifacts/:id` with
`{"acceptChange": true}`) marks it verified and makes it the new baseline. A later scrub or inspect
re-checks readability only; it never clears an unaccepted plausibility finding, and it never
brings back one that was accepted while it was reading. It keeps the copy's recorded contents
unless the re-read produces a new content summary, which then replaces them. The first backup of
anything is never an anomaly.

### Scrub

Weekly (`backup-scrub`, Sundays at 04:00 by default), per destination, Bench fully opens the newest
copy of each rule, kind and budget — decrypting first where its passphrase is stored, so an encrypted
backup is proved decryptable rather than merely present — and checksums three more, the ones verified
longest ago, so every copy is re-read over successive weeks. Copies recorded missing are looked for
again, up to 50 a scrub, those checked longest ago first, and come back as stored when they reappear.
A cancelled scrub stops without recording anything about the copy it was reading.

A scrub that finds damage **is** a failure and does count towards the streak. The reasoning is the
mirror image of a backup run: a failed backup means today's copy is missing and tomorrow's run may
fix it; a failed scrub means copies that already exist are bad, and repeating the scrub will not
improve them.

A copy that has disappeared is recorded as **missing**, not deleted — the distinction decides whether
to suspect retention or a disk.

## Retention

Refusals first, schedule second. In precedence order:

1. Pinned copies are never pruned.
2. Protected copies are never pruned while protected (this is what automatic recovery points use).
3. Nothing younger than `minimumAgeHours` is pruned.
4. The newest **verified** copy of each artifact kind and source budget, per rule, always survives;
   if none verified, the newest copy survives.
5. Manual backups are never expired automatically. **Back up now** on a scheduled rule makes a manual
   copy too, and does not trigger a prune.

Then grandfather-father-son: the newest copy of each of the last N days, weeks, months and years —
preferring, within a period, a copy that verified over a newer one that did not. The
surviving copy from rule 4 occupies its own day/week/month/year slot, so "keep 7 daily" keeps seven
rather than eight.

If a copy cannot be deleted, the artifact **keeps its row**. Removing Bench's record of a file that is
still in a destination would turn a transient error into an orphan nobody knows about.

`POST /api/backups/policies/:id/prune` previews by default; `{"apply": true, "artifactIds": [...]}`
performs it, removing only the previewed copies the plan still prunes. The preview is produced by the
same function that performs the prune. Applying also removes rows for runs that never stored a copy
(older than the minimum age).

Copies with no rule (rule deleted, or discovered) are outside retention. Attach one to a rule from its
detail (`PATCH /api/backups/artifacts/:id` with `{"policyId": "..."}`) and that rule's retention looks
after it. A budget copy can only be attached to the rule for the same budget, and an older encrypted
copy keeps the passphrase it was made with. Discovery attaches copies whose manifest names a rule that exists on this install and, for a budget copy, backs up that same budget; otherwise the copy is left with no rule.

## Safety recovery points

Before Bench saves a batch containing deletions or payee merges (or 25+ staged items), it takes a
budget-only backup of **the budget being saved**, through the enabled rule whose source is that
connection, tagged with what you were about to do. No such rule means no recovery point, and the user
is told. A rule whose budget only the browser can export (a Direct budget that is not enrolled) gets
the archive from the tab. These are `tier: auto`, protected for
`autoProtectionDays` or while they are among the newest `autoProtectionCount`, and then expire
normally — they are not pins.

Debounced (30 minutes by default) so one working session shares a recovery point. **Off by
default**; switch it on from the Recovery Center. If one cannot be taken, the UI asks before continuing rather
than silently dropping the safety net.

## Restore

Bench deliberately does not import for you. Actual's HTTP API has no import endpoint, and Actual's
own **Import file → Actual** always creates a *new* budget file, so "never overwrite the source" is
free.

To restore:

1. Download the artifact (decrypt it first if it ends in `.enc`).
2. Check `sha256sum` against `checksumSha256` in the manifest — or `plaintextChecksumSha256` when it
   was encrypted.
3. Import it into Actual.

**Look inside** (`POST /api/backups/artifacts/:id/inspect`) opens a copy server-side and reports its
contents without restoring anything. An inspection counts as a verification.

**Search inside** (`POST /api/backups/artifacts/:id/search`, body `{kind, text, from, to, page}`)
queries a budget copy's own database, read-only: `kind` is `transactions`, `payees`, `categories`
or `accounts`; `text` matches names, notes and imported descriptions case-insensitively, and a
number also matches an amount (`12.50` → 1250 minor units, either sign); `from`/`to` are ISO dates
for transactions. Results come 100 to a page with the total. Deleted rows (`tombstone = 1`), split
parents and transactions in deleted accounts are left out; payee and category ids go through
`payee_mapping` and `category_mapping`, so a merged payee shows as the one it became, and a
transfer shows the other account. Columns a copy's Actual version does not have are read as empty.
A search records nothing.

**Compare with now** (`POST /api/backups/artifacts/:id/compare`) sums each account in the copy and
reads the live budget through ActualQL (`accounts`, and `transactions` grouped by account), then
lists accounts added, removed, changed (balance, transaction count, closed, name or on/off budget)
and unchanged. For up to 10 changed accounts it also reads both sides' transactions and lists,
matched by id, the rows only in the copy, only in the live budget, and edited since (amount or
date), 50 of each at most. Only changed accounts are read this way: an account whose totals and
details all match is reported unchanged, so a date edit, or edits that cancel each other out, in
such an account are not listed. Both sides
count transactions by the rules of Actual's `v_transactions_internal_alive` view: not deleted, with a
date and an account, split parents left out, and a split line only while its parent exists and is
not deleted. The live budget is
read through an enrolment whose budget id matches the copy's, preferring the copy's rule's
connection. Without one the answer says so and the copy is not downloaded. A Direct budget that is
not enrolled lives only in a browser tab, so it cannot be compared yet.

Search and compare each fetch and decrypt the copy again on every request; nothing decrypted is
cached. Each is a worker task (`backup.search`, `backup.compare`), and a typed passphrase travels
sealed, as for Look inside.

## Passphrases Bench holds

A rule's passphrase is sealed under the vault key and stored against the rule's id. Two rules
about its lifetime matter more than they look:

- **Changing a rule's passphrase does not replace the old one.** The new passphrase is sealed under a
  new reference and applies to new copies; older copies keep the reference they were written with.
  Overwriting it in place made every older copy resolve to a passphrase that cannot open it.
- **Deleting a rule does not delete its passphrase.** Doing so would quietly make every encrypted
  backup that rule took unopenable — permanent data loss caused by tidying a setting. The Recovery
  Center lists what Bench is still holding and what depends on it.
- **It is collected automatically** once the last encrypted copy that needs it is gone (after a
  prune, a delete, or a rule deletion that left nothing encrypted behind). It can also be forgotten
  deliberately, which requires acknowledging how many backups that strands.

Each encrypted artifact records **which** sealed passphrase opens it
(`backup_artifacts.encryption_credential_ref`, schema v23). That cannot be derived from the rule:
deleting a rule sets the artifact's policy reference to null by design, which is exactly the moment
the link is needed.

## Encryption format

Optional, per rule, off by default. AES-256-GCM with a scrypt-derived key (N=32768, r=8, p=1). The
file is self-describing so it can be decrypted with nothing but itself and the passphrase:

```
bytes  0..7    magic 'BENCHBK1'
byte   8       format version (1)
byte   9       salt length (16)
byte   10      IV length (12)
byte   11      auth tag length (16)
then           salt, IV, auth tag, then ciphertext
```

The passphrase and derived key are never written anywhere — not in the manifest, not in the app
database beyond the sealed vault entry, not in the recovery sheet.

## Recovering from losing Bench

1. Stand up Bench on a new server with the **same vault key**: copy `secrets/vault.key` along with
   the database, or set the same `ACTUAL_BENCH_VAULT_KEY`. Without it you get back every rule but no
   stored credentials, and App Health asks you to reset the vault.
2. Add the destination again.
3. **Find backups** (`POST /api/backups/discover`) reads the manifests and rebuilds the inventory —
   verification state, retention tier and source budget intact. Discovery adds; it never overwrites a
   record Bench already has, and never deletes.
4. Restore Bench's own metadata database, if you have a copy, by stopping Bench, placing the file at
   `ACTUAL_BENCH_DB_PATH` (default `/data/actual-bench.sqlite`), and starting it again.

The **recovery sheet** (`GET /api/backups/recovery-sheet`) is a Markdown page documenting all of the
above against your actual paths and keys. It contains no secrets and is meant to be printed or kept
with your passwords.

## Readiness

The banner at the top is worked out **per rule**: each rule is judged on its budget (or on Bench's
settings for a settings-only rule), from its newest stored copy and its newest verified one, against
its own schedule. A manual rule is never "late". The headline is about the rule worst off, and with
more than one rule each gets a row. Only a rule's newest copy counts against it: an old failed copy
that retention happens to keep says nothing about whether the rule works today.

## Where the work runs

Verify now, Look inside, Search inside, Compare with now, Find backups, **Back up now** on a manual rule and recovery points run in a
disposable worker thread, like scheduled runs, so a large verification does not stall the web server.
An uploaded archive is parked in a private temp folder for the worker and removed afterwards; a
passphrase typed for one Look inside travels to the worker sealed with the vault key. With
`ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread` the same work runs in the server thread.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "has no stored credentials. Re-enter its access key" | The destination's sealed credential is missing. Fails closed by design. |
| "Could not unseal credentials … the vault key may have changed" | The vault key changed since the credential was stored. App Health shows the vault as locked, with the fix. |
| "not enrolled for unattended use" | The source connection has no vault credential; enrol it from the backup rule dialog or Automations → Connections. |
| "does not look like the folder Bench has been writing to" | The destination's marker file and its newest copy are both missing: usually an unmounted volume. Mount it and try again. |
| Backup stored but "could not confirm it is readable" | Verification failed. Open the copy's detail for the findings — usually a truncated or non-Actual archive. |
| A rule shows "paused after repeated failures" | The engine auto-paused its automation. Fix the cause, then Resume from the Automations page — editing the rule does not clear a pause. |
| A rule shows "paused on the Automations page" | Someone paused the automation by hand. Re-enabling the rule does not undo that, on purpose. |
| Scrub reports "Size changed" | The stored object is not the size it was written at: a truncated upload or a full volume. |
| Scrub reports "bytes have changed" | Checksum mismatch — bit rot, or something rewrote the object. |
| Destination test passes but backups fail | Check free space; the probe is 64 bytes and a real export is not. |

## Not in scope

Restoring into an existing budget in place; continuous or point-in-time backup; backing up an Actual
server's own database or its other budget files; notification channels; and coordinating backups
across more than one Bench instance.
