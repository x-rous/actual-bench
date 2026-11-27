# Privacy Policy

Actual Bench is software you run yourself. Your financial data stays with you: on your Actual
server, on the machine that runs Actual Bench, and in your browser. The Actual Bench maintainer
does not run a service behind your installation. A self-hosted copy of Actual Bench sends the
maintainer nothing: no financial data, no usage statistics, no error reports.

This policy explains what Actual Bench reads, what it keeps, where it connects to, and how to
remove it. It covers three different things, which are treated differently:

| | What it is | Who runs it |
|---|---|---|
| **Your installation** | Actual Bench running on your own server, NAS, PC or hosting account | You |
| **The public demo** | [actual-bench-demo.vercel.app](https://actual-bench-demo.vercel.app), a shared sandbox with sample data | The maintainer |
| **The documentation website** | [x-rous.github.io/actual-bench](https://x-rous.github.io/actual-bench/), a static website | The maintainer, hosted on GitHub Pages |

Most of this policy is about your installation. The demo and the documentation website have their
own sections at the end.

For how to report a security problem, and how the security design works, see
[SECURITY.md](SECURITY.md).

---

## In short

- **You own your data.** Actual Bench reads your budget from your own Actual server. The person who
  runs the installation (usually you) controls everything it stores.
- **No telemetry.** Self-hosted Actual Bench has no analytics, tracking, usage statistics or
  automatic error reporting. The published Docker image does not include the demo's analytics code.
- **Nothing is sent to the maintainer.** No part of your budget, your settings or your credentials
  ever goes to the Actual Bench project.
- **Few outside connections, all listed below.** Apart from your Actual server, the app makes two
  kinds of outside request on its own: an update check to GitHub and, when you convert between
  currencies, an exchange-rate lookup. Neither request contains your financial data. Everything
  else (backups to cloud storage, scheduled syncs) happens only after you set it up.
- **Statements stay in your browser.** Bank statement files (PDF, CSV, OFX, QIF and others) are
  read in your browser. The file itself is never uploaded or kept.
- **Passwords are encrypted, or not kept at all.** Saved credentials are encrypted. Bench never
  writes a password, API key or encryption key to your browser's storage.
- **You can delete it.** Every item can be removed in the app, and deleting the `/data` volume
  removes everything Actual Bench has stored on your server.

---

## 1. Data ownership and self-hosting

Actual Bench is open-source software (MIT licence). You install it on hardware or hosting that you
choose, and it connects to an Actual Budget server that you choose. There is no Actual Bench
account, no sign-up and no central server.

Whoever runs an installation is in control of its data. That person can read the server's files
and logs, set the sign-in password, and decide who can reach the app. If someone else hosts
Actual Bench for you, that person or company holds this data, not the Actual Bench project.

Actual Budget stays the home of your budget. Actual Bench works from that data and does not keep a
second, permanent copy of your budget on its server (the exceptions you can switch on are
[backups](#8-backups-and-automations) and the short-lived working copies described in
[section 3](#3-local-data-storage-and-retention)).

## 2. Financial data collection and processing

**What Actual Bench reads from Actual.** To show and edit your budget, Actual Bench reads what
Actual holds for the budget you open: accounts and balances, transactions, payees, categories,
budget amounts, rules, schedules, tags and notes.

**How it is read** depends on the connection type you choose on the connection screen:

- **Direct Actual Server:** your browser connects straight to your Actual server, using Actual's
  own browser software. The budget is not passed through the Actual Bench server.
- **HTTP API Server:** requests go from your browser, through the Actual Bench server, to your
  [actual-http-api](https://github.com/jhonderson/actual-http-api) bridge. The Actual Bench server
  passes them on and returns the answers. It does not keep them.

**What it does with the data.** All calculations (Financial Insights, loan schedules, cashflow
plans, reconciliation matching, rule diagnostics and so on) run inside your own installation, in
your browser or on your Actual Bench server. Nothing is sent elsewhere to be processed. Actual
Bench does not use your data for advertising, profiling or training of any kind.

**Changes to Actual.** Actual Bench writes to your budget only when you choose to: most edits wait
for **Save**, reconciliation and Cross Budget Sync wait for **Apply**, and scheduled changes run only
if you set up an automation for them. A few small actions, such as notes and the carryover switch,
save as soon as you make them. See
[Editing, review and save](https://x-rous.github.io/actual-bench/getting-started/editing-and-saving/).

## 3. Local data storage and retention

Actual Bench keeps data in three places.

### In your browser

- **While you use the app:** the budget data on screen and your unsaved edits are held in the
  browser tab's memory. Closing the tab clears them.
- **Direct mode working copy:** in Direct mode, Actual's own browser software keeps a working copy
  of the open budget in this website's browser storage, just as Actual's web app does in your
  browser. It is removed when you clear this site's data in your browser.
- **Small preferences:** things such as the sidebar state, table filters, a dismissed update notice,
  and the address and label of servers you recently connected to. These never include a password,
  API key or encryption key.

### In Actual Bench's database on your server

Actual Bench has its own small SQLite database (by default `/data/actual-bench.sqlite`). It holds
what you create in Actual Bench and the settings it needs to work, **not a copy of your budget**.
Some of it is financial information that you entered or that Bench worked out, so treat the file as
private:

- Account types and the other details you give your accounts.
- Loans (terms, rates, payments and the links to your Actual accounts), assets (values, ownership,
  depreciation) and credit cards (limits, statement figures, payment plans and review decisions).
- Cashflow plans, Financial Insights settings and scenarios.
- Bank reconciliation sessions, including the statement rows you imported (see
  [section 7](#7-bank-statement-processing)), and saved PDF layouts.
- Cross Budget Sync flows, the record of which items were copied where, and exchange rates with the
  converted amounts of synced transactions.
- Automations, backup rules and destinations, and the run history of each.
- Saved ActualQL queries and decisions such as dismissed diagnostics and payee suggestions.
- The address, label and budget names of servers you chose to remember, and their credentials in
  encrypted form (see [section 6](#6-credential-storage-and-encryption)).

**How long it is kept.** Your own items stay until you delete them. Run history is trimmed
automatically to the latest 100 runs for each automation and each sync flow.

### Temporary working copies on your server

When an automation runs on the server (a scheduled backup, bank sync or Cross Budget Sync), it
downloads the budget into a temporary folder (by default `actual-runtime` next to the database),
does its work, and deletes the folder when the run ends. Folders left behind by an interrupted run
are cleaned up when Actual Bench next starts.

## 4. Telemetry and analytics

Self-hosted Actual Bench contains **no telemetry, analytics, tracking, usage statistics or automatic
error reporting**.

- The analytics script used on the public demo is switched on by a setting that exists only when the
  demo is built. In every other build, including the published Docker image, it is removed from the
  app entirely, so it never loads.
- Next.js's anonymous build telemetry is turned off in the official Docker images.
- Errors are shown to you on screen and written to your own server's log. They are never sent
  anywhere automatically.
- Actual Bench sets no advertising or tracking cookies. Its only cookie keeps you signed in and
  your saved connections unlocked.

## 5. External services and network communications

This is the complete list of connections Actual Bench makes.

### Made by default

| Connection | When | What is sent |
|---|---|---|
| **Your Actual server** (or your actual-http-api bridge) | When you connect and use a budget | What is needed to read and change that budget, with the credentials you entered |
| **GitHub** (`api.github.com`), update check | When the app is opened, at most once an hour, from the Actual Bench server | A request for the latest release number. Nothing about you or your budget. GitHub sees your server's IP address |

The update check cannot be switched off with a setting. If your server cannot reach GitHub, the
check fails quietly and the app works normally without the "new version" notice.

Fonts and all other app files are part of the app and served by your own installation. Nothing is
loaded from a third-party website.

### Made only when you use a feature

| Connection | When | What is sent |
|---|---|---|
| **Frankfurter** (`api.frankfurter.dev`), exchange rates | When a conversion between two currencies needs a rate that is not already stored, in [Exchange Rates](https://x-rous.github.io/actual-bench/user-guide/fx-rates/) or Cross Budget Sync | The two currency codes and the dates. No amounts, accounts or other budget data. The rate is then stored, so the same rate is not fetched again |
| **Your bank, through Actual** | When you run or schedule [bank sync](https://x-rous.github.io/actual-bench/user-guide/bank-sync/) | Actual Bench only asks your Actual server to run the bank sync you already set up in Actual. Your Actual server contacts the bank-data provider. Actual Bench does not connect to banks or bank-data providers |
| **S3-compatible storage** you add as a backup destination | When a backup runs or is checked | The backup files (see [section 8](#8-backups-and-automations)) |
| **Other Actual servers or budgets** you add | When a Cross Budget Sync flow, backup or automation uses them | What is needed to read or write those budgets |

Actual Bench refuses to connect to the cloud metadata addresses that some hosting providers use
for their own credentials, even if such an address is typed in by mistake.

## 6. Credential storage and encryption

Actual Bench handles four kinds of secret: your Actual server password or HTTP API key, budget
encryption passwords, credentials for backup storage and backup encryption passphrases, and your
Actual Bench sign-in password.

- **In your browser,** credentials are kept in memory only, for as long as the tab is open. They are
  never written to browser storage, put in web addresses, or included in error messages.
- **Your Actual Bench password** is not stored. Bench keeps only a value it can check your password
  against.
- **Remembered connections** (the *Remember this budget* choice, ticked by default when saving is
  available; untick it to keep credentials in memory only) are encrypted with AES-256-GCM on the
  server, using a key made from your Actual Bench password. That key is never
  written to disk: it is held in the server's memory while you are signed in, and is gone after a
  restart or when your session ends. Without your password, the stored credentials cannot be
  decrypted.
- **Credentials for automations and backups** must work while nobody is signed in, so they are
  encrypted (AES-256-GCM) with a separate vault key. Actual Bench generates this key on first start
  and stores it at `/data/secrets/vault.key`, or you can supply your own with
  `ACTUAL_BENCH_VAULT_KEY`. Anyone who has both the database and the vault key can decrypt these
  credentials, so keep the `/data` volume private. Decrypted credentials are used only on the server
  and are never sent to the browser.
- **Backup encryption passphrases** are stored only if you choose to store them, so that scheduled
  backups can be encrypted and checked. They are kept in the same encrypted vault.

[SECURITY.md](SECURITY.md) and the
[Configuration guide](https://x-rous.github.io/actual-bench/administration/configuration/) describe
the vault, sign-in and key settings in more detail.

## 7. Bank statement processing

When you import a statement for [Bank Reconciliation](https://x-rous.github.io/actual-bench/user-guide/bank-reconciliation/)
(CSV, TSV, OFX, QFX, QIF, pasted text or a text-based PDF):

- **The file is read in your browser.** PDF statements are read with PDF.js inside your browser.
  The file is never uploaded to the Actual Bench server, never sent to a third party, and never
  stored.
- **The transactions you import are saved with the reconciliation session,** so that you can come
  back to it later. For each row this means the date, amount, the bank's description, memo and
  reference, and the original cells of that row. They stay in Actual Bench's database until you
  delete the session.
- **Saved PDF layouts** record the bank name and where the columns are on the page, so the next
  statement from the same bank is read the same way. They do not contain your transactions.
- **Credit card statements** in [Credit Cards](https://x-rous.github.io/actual-bench/user-guide/credit-cards/)
  are figures you type in (balance, minimum payment, dates) and your review decisions. They stay in
  the database until you delete them.

## 8. Backups and automations

Backups and automations are **off until you set them up**.

- **A budget backup is a full copy of your budget**, taken from Actual. A Bench backup is a copy of
  Actual Bench's own database, which includes the encrypted credentials but not the vault key.
- **You choose where backups go**: a folder on your server, or S3-compatible storage such as your
  own MinIO or a cloud provider. A backup sent to a cloud provider is held by that provider under its
  own terms.
- **Encryption is optional**, and is worth switching on for any copy that leaves your own hardware.
  Encrypted backups use AES-256-GCM with a key made from a passphrase you choose. The passphrase and
  the key are never written into the backup.
- **You set retention.** Bench removes older copies according to the retention rules you choose.
- **Automations** (scheduled backups, bank sync and Cross Budget Sync) run on your Actual Bench
  server, using the credentials you enrolled for them. Their results stay in your run history.

## 9. Data deletion

Deleting data in Actual Bench never deletes anything in Actual. Your budget stays in Actual.

**Single items.** Loans, assets, cards, cashflow plans, reconciliation sessions, sync flows,
automations, backup rules, saved queries and remembered servers can each be deleted in the app.
Deleting a reconciliation session also deletes the statement rows imported into it.

**Credentials.** Forget a remembered server from the connection screen. Remove a credential
enrolled for automations from the **Connections** tab in
[Automations](https://x-rous.github.io/actual-bench/user-guide/automations/). Forget a stored
backup passphrase in [Backups](https://x-rous.github.io/actual-bench/user-guide/backups/).

**Everything on your server.** Stop Actual Bench and delete its data volume (`/data` in the
Docker examples). That removes the database, the vault key and any temporary working copies.
Backups you sent to other folders or storage services must be deleted there.

**Your browser.** Clear this website's data in your browser's settings. That removes the Direct
mode working copy of your budget and your display preferences.

## 10. Public demo privacy

The [public demo](https://actual-bench-demo.vercel.app) is a shared sandbox run by the maintainer.
It works differently from your own installation:

- **It holds made-up sample data only.** Every visitor uses the same sample budgets, with no sign-in.
  Anything you type can be seen or changed by other visitors until the demo resets, which happens
  whenever its server restarts. **Do not enter real financial information, and do not connect your
  own Actual server to the demo.**
- **It uses Vercel Web Analytics.** The demo's pages are served by Vercel, and the demo counts page
  visits with [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy). This is the
  only place Actual Bench uses analytics.
- **Its server runs on Hugging Face.** The demo's API and sample budgets run in a
  [Hugging Face Space](https://huggingface.co/spaces). Requests made in the demo are handled there.
- Vercel and Hugging Face process visit data such as IP addresses to deliver the service, under
  their own privacy policies.

## 11. Documentation website

The [documentation website](https://x-rous.github.io/actual-bench/) is a set of static pages hosted
on GitHub Pages. It has no analytics, no tracking and no forms. Its search runs in your browser.
It remembers your light or dark theme choice in your browser. GitHub, as the host, receives visit
data such as IP addresses, as described in the
[GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## 12. Application logs

Actual Bench writes logs to its own server output (for Docker, `docker logs`). They stay on your
server unless you forward them somewhere yourself. Logs contain:

- Start-up and health messages (sign-in mode, vault status, database checks).
- Automation and backup summaries: what ran, how many items, and any error message.
- In HTTP API mode, one line per request: the method, the address path (which contains budget and
  account IDs), the status code and how long it took.

Logs do not contain request or response contents, passwords, API keys or encryption keys. Error
messages returned by your Actual server are logged as they arrive, so redact logs before you share
them in an issue. `LOG_LEVEL=warn` makes the log quieter.

## 13. Privacy questions and concerns

- **A possible leak of data or credentials, or another security problem:** report it privately
  through [GitHub's vulnerability reporting](https://github.com/x-rous/actual-bench/security/advisories/new),
  as described in [SECURITY.md](SECURITY.md). Please do not open a public issue for these.
- **A question about this policy, or something in it that seems inaccurate:** open an
  [issue](https://github.com/x-rous/actual-bench/issues). Do not include real financial data, logs
  that have not been redacted, or credentials.

Because Actual Bench is open source, every statement here can be checked against the
[source code](https://github.com/x-rous/actual-bench).

## Changes to this policy

This policy is kept in the repository, and changes to it are listed in the project's history and
release notes. If a future release adds a new outside connection or changes what is stored, this
policy is updated in the same release.
