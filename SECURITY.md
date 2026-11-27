# Security Policy

## Supported Versions

Actual Bench ships continuous releases (see [GitHub Releases](https://github.com/x-rous/actual-bench/releases)).
The same version is published as a Docker image on
[Docker Hub](https://hub.docker.com/r/xrous/actual-bench). Security fixes target the latest
released version and its matching image tag; there are no long-term support branches.

## Reporting a Vulnerability

Please use GitHub's private reporting flow rather than a public issue:
[**Report a vulnerability**](https://github.com/x-rous/actual-bench/security/advisories/new)
(Security tab, "Report a vulnerability").

Include, if possible:

- A description of the issue and its impact
- Steps to reproduce, or a minimal example
- The version/commit you tested against

You should get an initial response within a few days. Confirmed reports are fixed as soon as
practical and credited in the advisory unless you'd rather stay anonymous.

## How Actual Bench Handles Sensitive Data

Actual Bench is a self-hosted companion UI for Actual Budget. What it stores, which external
services it contacts and how to delete its data are covered in the [Privacy Policy](PRIVACY.md).
A few design choices are useful context when assessing a report:

- **Credentials in the browser**: Actual server passwords, HTTP API keys and budget encryption
  passwords are held in memory only. They are never written to browser storage, URLs or error
  messages; only non-secret server presets (address and label) use session storage.
- **Remembered connections**: the optional "Remember this budget" feature seals secrets with
  AES-256-GCM in the server-side metadata database, with a key derived (scrypt) from your Actual
  Bench password. The derived key is held in server memory for the signed-in session only and is
  never persisted, so the stored secrets cannot be decrypted at rest without the password.
- **Automation and backup credentials**: credentials enrolled for unattended work, S3 credentials
  and stored backup passphrases are sealed with AES-256-GCM under a separate operator vault key
  (`ACTUAL_BENCH_VAULT_KEY`, or a key file generated at `/data/secrets/vault.key`). The server can
  decrypt these without a user present, which is what unattended runs need, so the database and the
  key file together must be protected. Decrypted values are used only on the server and never
  sent to the browser. A missing or wrong key locks the vault and fails closed.
- **Outbound requests**: the server refuses connections to cloud metadata addresses
  (such as `169.254.169.254`) for user-supplied Actual, HTTP API and S3 endpoints.
- **Access control**: Actual Bench asks for a single operator password (no user accounts). The
  same password encrypts saved connections. Operators may turn sign-in off
  (`ACTUAL_BENCH_AUTH=none`) when their own proxy, VPN or hosting platform controls access; a report
  that only applies with sign-in off is still welcome, but is judged in that light. Our [deployment docs](https://x-rous.github.io/actual-bench/administration/deployment/)
  cover recommended setups for self-hosting safely.
- **Operational endpoints**: any current or future operational/metrics endpoint (health checks,
  automation status, and similar) is scoped to expose no financial data (balances, category
  totals, transaction contents). A report showing financial data reaching one of these endpoints
  is treated as high severity.
- **No telemetry**: self-hosted builds send no analytics or error reports. Financial data or
  credentials reaching any third party, or the browser receiving a decrypted vault secret, is
  treated as a vulnerability; report it through the private flow above.

## Dependencies

Dependency updates are automated with Dependabot (npm, Docker base images, GitHub Actions) and
reviewed weekly, which also keeps the [published Docker image](https://hub.docker.com/r/xrous/actual-bench)
current. Reports about vulnerable transitive dependencies are welcome too; they help us prioritize
the update.
