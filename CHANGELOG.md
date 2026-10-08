# Changelog

See [GitHub Releases](https://github.com/x-rous/actual-bench/releases) for the full changelog.

## Pending Assets & Debt release

- Require confirmation for new extra-payment assumptions and successful sync before loan writes
- Recover abandoned loan writes safely and distinguish confirmed history from forecasts
- Keep financial browser drafts and caches in memory and use local calendar dates
- Align HTTP Budget File Sync transfer insertion with Direct mode: transfer payees create the counterpart leg (`runTransfers: true`)
- Add metadata schema v45 execution leases; preserve additive v38–v44 migrations and the existing schema-drift repair
