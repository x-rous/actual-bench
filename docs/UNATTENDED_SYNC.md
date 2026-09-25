# Unattended Server-Side Scheduled Sync

Budget File Sync can run **safe-only** syncs on a server schedule with **no browser open**.
This is opt-in, **off by default**, and available for **HTTP API Server** and **Direct**
flows alike. Unattended runs happen on the Node server: an HTTP API budget through
`actual-http-api`, a Direct budget with Actual's own engine in a worker thread (so the
server must be able to reach the Actual server). The old client-side interval, which ran
only while the app was open, is turned off.

## What it does

- On a per-flow frequency (minimum 15 minutes), the server previews and applies **only the safe
  classes** (new creates, marker-match repairs) — exactly like the in-app interval. Uncertain
  items (duplicates, source-changed, blocked) always go to the review queue and are never
  auto-applied. Updates and deletes remain review-only.
- Runs are recorded in history stamped `scheduled_unattended`, identical in structure to manual
  and interval runs, and appear on the Automations page as well with a link back to the sync run.

## Enabling it

1. **Nothing to set up on the server.** The credential vault always exists. On first start
   Bench generates its key and keeps it in `secrets/vault.key` beside the metadata database
   (`/data/secrets/vault.key` in Docker). To hold the key yourself instead, set
   `ACTUAL_BENCH_VAULT_KEY` before the first start (see [The vault key](#the-vault-key)).

2. **The engine runs on its own.** The in-process **automation engine** starts on boot and ticks
   about once a minute (single instance is sufficient).

3. **Configure a flow.** In the flow editor, set the review policy to
   **"Auto-sync on a server schedule (unattended)"**, choose a frequency, then click **"Store
   credentials for unattended sync"** to enroll both budgets (API key or Actual server password).

4. **Check status** on the **Automations** page (Tools → Automations): schedule, last run, next
   run, pause reasons and run history. The **App Health** page carries the same roll-up alongside
   vault state and enrolled count. See [`AUTOMATIONS.md`](AUTOMATIONS.md).

## Security / threat model

- **What is stored:** for each enrolled server, its `actual-http-api` **API key** (HTTP API
  connections) or the Actual server's **password** (Direct connections), and for each enrolled budget
  its encryption password if used, **AES-256-GCM encrypted**, in the app metadata database
  (`credentials` table; which budgets are enrolled is recorded, without secrets, in
  `unattended_connections`). Budgets on the same server share one stored secret.
- **Checked before it is stored.** Enrolling first checks the credentials against the server, in a
  worker thread (for Direct, by opening the budget). A wrong key, password or encryption password
  is reported and **nothing is stored**, so a typo cannot replace the working secret other budgets
  on that server rely on. The secret reaches the worker only sealed with the vault key.
- **The key is not in the database.** Encryption uses a key derived from the vault key, which
  lives in `secrets/vault.key` beside the database or in `ACTUAL_BENCH_VAULT_KEY`. Someone with
  only the database file cannot decrypt the secrets. Someone with a copy of the whole data folder
  can, when the key is the generated file; hold the key in `ACTUAL_BENCH_VAULT_KEY` if that
  matters to you.
- **Never exposed to the client.** Stored secrets are decrypted server-side only, during a
  scheduled run; the API and the UI only ever see non-secret metadata.
- **Fail-safe.** A locked vault (key missing or changed) or an auth failure **pauses the
  automation and surfaces the reason** on Automations and App Health — it never guesses, never runs
  partially against a credential it could not resolve, and never retries forever.
- **Redacted output.** Credentials opened during a run are redacted from run logs and stored errors,
  including when a provider echoes a key back in an error message.

## Disabling

- **One flow:** in the flow editor, switch its policy away from unattended and/or click
  **"Remove stored credentials"** to withdraw its vault entry.
- **Every budget:** withdraw each one on **Automations → Connections**.

## The vault key

Bench looks for the key in this order and uses the first it finds:

1. `ACTUAL_BENCH_VAULT_KEY`
2. `SYNC_VAULT_KEY`, the old name. It still works, with a warning in the log and App Health.
3. `secrets/vault.key` beside the metadata database.

If none is found and **nothing is stored yet**, Bench generates a key into that file (mode `0600`,
folder `0700`). It never generates a key while stored credentials exist, and it never overwrites a
key file. To use a Docker or Kubernetes secret, mount it at that path.

**Keep the key with your data.** Back up `secrets/vault.key` with the database, or keep your
`ACTUAL_BENCH_VAULT_KEY` value somewhere safe.

### When the vault is locked

If Bench can't find the key that sealed its stored credentials, or the key it has doesn't open
them, the vault is **locked**. Automations that need stored credentials pause, the connect screen
shows a notice, and **App Health** says why, with the fix:

- **Restore the key:** put the old `vault.key` back or set `ACTUAL_BENCH_VAULT_KEY` to the old
  value, then click **Check again**. No restart needed.
- **Reset the vault:** if the key is gone, **Reset vault** deletes the stored secrets Bench can no
  longer open and every unattended enrolment, and starts again. Enrol your budgets and re-enter
  backup credentials afterwards. Remembered connections are not affected. A reset is refused while
  the vault works.

Changing the key on purpose is the same thing: the old secrets can't be opened, so reset and enrol
again.
