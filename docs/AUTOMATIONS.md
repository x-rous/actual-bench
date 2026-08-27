# Automations

Actual Bench runs scheduled work — Budget File Sync, scheduled bank sync, and backups — through one
**automation engine**. The Automations page (Tools → Automations) is where you
see what runs, when it last ran, what it did, and what needs your attention.

> **This is not Actual Budget's "Budget Automations".** That is an experimental feature inside
> Actual itself. Automations here are Actual Bench's own scheduled jobs, and Bench does not drive
> Actual's feature.

## What you see

Each automation shows, without opening it:

- its schedule in plain language ("Every 30 minutes", "Daily at 06:00 (Europe/Berlin)");
- when it last ran, and how that run ended;
- when it runs next;
- whether it is auto-paused, and why;
- **where it runs** — the single most important line on the page.

## Where an automation runs

This is stated on every automation, because getting it wrong means expecting work that never
happens.

| Mode | What it means |
|---|---|
| **Runs on the server** | Runs on schedule even with Actual Bench closed, using credentials you enrolled in the encrypted vault. Requires HTTP API mode and `SYNC_VAULT_KEY`. |
| **Runs in your browser** | Runs only while Actual Bench is open in a tab. Close the tab and it stops. This is a convenience, not unattended automation. |

Direct (browser) mode cannot run unattended: Actual's engine runs in your browser, so there is
nothing on the server to run. Bench says so rather than implying otherwise.

**One instance only.** The engine runs inside the Actual Bench server process and prevents a
single automation from overlapping *itself within that process*. Running two Bench containers
against the same database would run your automations twice. Bench does not coordinate across
instances.

## Schedules

Two kinds:

- **Interval** — "every N minutes". A 15-minute floor applies to unattended runs, because each run
  opens and syncs a whole budget file.
- **Cron** — a standard five-field expression (`minute hour day-of-month month day-of-week`) with
  an explicit time zone. Supported: `*`, lists (`0,30`), ranges (`9-17`), and steps (`*/15`).
  Not supported, deliberately: `@daily`-style macros, `L`/`W`/`#` day modifiers, seconds and years.

Daylight saving is handled explicitly, so a 02:30 job behaves sensibly twice a year:

- when the clocks go **forward** and 02:30 does not exist, the run happens as the gap closes
  (03:00), rather than being skipped for the day;
- when the clocks go **back** and 02:30 happens twice, the run happens **once**, at the first
  occurrence.

## When something goes wrong

- A failed run is recorded with its reason and counts against the automation's failure streak.
- Retries **back off**: each consecutive failure pushes the next attempt further out, up to a
  ceiling, so a broken automation does not hammer a server.
- After enough consecutive failures the automation **auto-pauses**, with the reason shown on the
  card. It stays paused until you press **Resume**, which clears the pause and the failure count.
- If an automation needs a stored credential and the vault is unavailable — `SYNC_VAULT_KEY` unset
  or rotated, or the credential removed — it **fails closed**: it does not run at all, and it pauses
  with that reason. It never runs partially against a credential it could not fully resolve.
- Editing an automation's schedule does **not** clear a pause. Resuming is a separate, deliberate
  decision about something that was broken.

A run that succeeded a long time ago is not the same as a healthy automation. If an automation is
well past its next run and nothing has happened, Bench marks it **overdue** — usually a sign the
server is not running.

## Secrets in logs

Run logs and stored errors are redacted. Any credential an automation opens is registered for
redaction at that moment, so a provider error that echoes an API key back cannot reach the log,
the run history, or the UI.

## Budget File Sync as an automation

A sync flow set to **"Auto-sync on a server schedule (unattended)"** appears here automatically —
you do not create it twice. Its schedule and enabled state carry over from the flow, and a flow you
enrol while the server is running appears as soon as you open or refresh this page, rather than at
the next restart. (The engine also sweeps once a minute, so it is picked up even with no page open.)

A flow set to manual review, or to sync while Bench is open, is deliberately **not** listed here:
those are not unattended, and showing them would imply the server runs them.

Full sync history stays in Budget File Sync, which is where the detail belongs (previews, items,
the review queue). Each automation run links to the sync run it produced.

Items the sync could not decide on are never applied automatically. They show up on the Automations
page under **"Waiting for you to decide"**, linking into the sync workspace where you can actually
review them. Job types that only trigger Actual's own work — rather than constructing writes
themselves — have nothing to review and do not appear there at all.

## Bank sync

**Schedule bank sync** on the Automations page asks Actual to pull from the banks you connected *in
Actual* (SimpleFIN / GoCardless), on a schedule, with nothing open. Bench triggers Actual's own
import — it does not create the transactions and does not change how Actual handles duplicates.

It needs a connection whose credentials are enrolled in the vault, because that is what lets it run
unattended; without one the dialog says so rather than creating an automation that could only pause.

What a run reports, per account:

- **Synced** or **Sync started**, depending on whether the connection tells Bench the import
  finished. Over the HTTP API the server answers "started", so Bench says the sync began instead of
  quoting a number it cannot verify.
- **Failed**, with the provider's reason, for that account only. Accounts are synced one at a time,
  so one bank with expired consent cannot hide the rest — and a run where some accounts worked is
  reported as partly done rather than as a failure.
- **No bank link**, for an account Actual would silently skip. It is never counted as synced.

A partial run does **not** count towards the failure streak that auto-pauses an automation: one
unreachable bank is an ordinary outcome, and pausing would stop the accounts that do work. A run
where *every* account failed does count.

Bank sync contributes nothing to the review queue. It constructs nothing for you to review — Actual's
importer owns what arrives.

## External cron

If you would rather drive the schedule yourself, `POST /api/sync/scheduler/tick` runs one pass.
It requires `SYNC_SCHEDULER_SECRET` in the server environment and a matching `x-scheduler-secret`
header. The endpoint kept its URL when the engine replaced the sync-specific scheduler, so existing
crons keep working.

## Related

- [`UNATTENDED_SYNC.md`](UNATTENDED_SYNC.md) — enrolling credentials and the vault.

## Related

- Backups and their `backup` / `backup-scrub` job types: `docs/BACKUPS.md`.
