# Unattended Server-Side Scheduled Sync

Budget File Sync can run **safe-only** syncs on a server schedule with **no browser open**.
This is opt-in, **off by default**, and available for **HTTP API Server mode** flows only.

> Direct-mode flows keep the client-side interval (they run only while the app is open),
> because Direct sync runs the Actual engine in the browser. Unattended runs happen on the
> Node server, which can reach `actual-http-api` directly.

## What it does

- On a per-flow frequency (minimum 15 minutes), the server previews and applies **only the safe
  classes** (new creates, marker-match repairs) — exactly like the in-app interval. Uncertain
  items (duplicates, source-changed, blocked) always go to the review queue and are never
  auto-applied. Updates and deletes remain review-only.
- Runs are recorded in history stamped `scheduled_unattended`, identical in structure to manual
  and interval runs.

## Enabling it

1. **Set the vault key.** Provide a strong secret in the server environment:

   ```bash
   SYNC_VAULT_KEY="a-long-random-operator-secret"
   ```

   Without it, the whole feature is disabled: nothing is persisted and the scheduler never runs.

2. **Restart the server.** The in-process scheduler starts on boot when `SYNC_VAULT_KEY` is set
   (it ticks about once a minute; single instance is sufficient).

3. **Configure a flow.** In the flow editor, set the review policy to
   **"Auto-sync on a server schedule (unattended)"** (available only when both source and target
   are HTTP API connections), choose a frequency, then click **"Store credentials for unattended
   sync"** to enroll the budgets' API keys in the vault.

4. **Check status** on the **App Health** page → *Unattended sync scheduler* (vault state, enrolled
   count, last tick, health-paused flows, recent run statuses).

### Optional: external cron

The in-process scheduler is enough for most setups. To drive it externally instead (or in
addition), set `SYNC_SCHEDULER_SECRET` and hit the trigger endpoint on your own schedule:

```bash
curl -X POST https://your-host/api/sync/scheduler/tick -H "x-scheduler-secret: $SYNC_SCHEDULER_SECRET"
```

Without `SYNC_SCHEDULER_SECRET` set, that endpoint is disabled (403).

## Security / threat model

- **What is stored:** for each enrolled connection, its `actual-http-api` **API key** (and budget
  encryption password if used), **AES-256-GCM encrypted**, in the app metadata database
  (`sync_credentials` table).
- **The key is not in the database.** Encryption uses a key derived from `SYNC_VAULT_KEY` (an
  environment variable). Someone with only the database file cannot decrypt the secrets.
- **Never exposed to the client.** Stored secrets are decrypted server-side only, during a
  scheduled run; the API and the UI only ever see non-secret metadata.
- **Fail-safe.** A missing/locked vault (key unset or changed) or an auth failure **pauses the
  flow and surfaces it** on App Health — it never guesses or silently retries forever.

## Disabling

- **One flow:** in the flow editor, switch its policy away from unattended and/or click
  **"Remove stored credentials"** to withdraw its vault entry.
- **Everything:** unset `SYNC_VAULT_KEY` and restart. The scheduler stops and stored secrets can
  no longer be decrypted.

## Rotating the key

Changing `SYNC_VAULT_KEY` invalidates all existing ciphertext (by design — old secrets can no
longer be decrypted). After rotating, **re-enroll** each unattended flow's credentials. Flows whose
credentials can't be decrypted are paused and shown on App Health until re-enrolled.
