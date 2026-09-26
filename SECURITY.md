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

Actual Bench is a self-hosted companion UI for Actual Budget. A few design choices are useful
context when assessing a report:

- **Credentials**: Actual server and API credentials are kept in memory or session storage by
  default. The optional "Remember servers" feature seals secrets with AES-256-GCM in the
  server-side metadata database, encrypted with a key derived from your Actual Bench password;
  the server itself cannot decrypt them without it.
- **Access control**: Actual Bench asks for a single operator password (no user accounts). The
  same password encrypts saved connections. Operators may turn sign-in off
  (`ACTUAL_BENCH_AUTH=none`) when their own proxy, VPN or hosting platform controls access; a report
  that only applies with sign-in off is still welcome, but is judged in that light. Our [deployment docs](https://x-rous.github.io/actual-bench/administration/deployment/)
  cover recommended setups for self-hosting safely.
- **Operational endpoints**: any current or future operational/metrics endpoint (health checks,
  automation status, and similar) is scoped to expose no financial data (balances, category
  totals, transaction contents). A report showing financial data reaching one of these endpoints
  is treated as high severity.

## Dependencies

Dependency updates are automated with Dependabot (npm, Docker base images, GitHub Actions) and
reviewed weekly, which also keeps the [published Docker image](https://hub.docker.com/r/xrous/actual-bench)
current. Reports about vulnerable transitive dependencies are welcome too; they help us prioritize
the update.
