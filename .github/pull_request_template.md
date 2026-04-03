<!--
  Target branch: edge  (not main)
  main is updated only when changes warrant a release — all PRs go to edge first.

  PR title: make it user-facing — this becomes the changelog entry verbatim.
    ❌  wip stuff / fix bug / update things
    ✅  Add schedules page with basic CRUD / Fix rule drawer width behind Traefik

  Label: auto-applied from your branch name — verify before merging.
    feat/*    → feat        → 🚀 Features
    fix/*     → fix         → 🐛 Bug Fixes
    refactor/* → maintenance → 🔧 Maintenance
    docs/*    → docs        → 🔧 Maintenance
-->

## Summary

<!-- What does this PR do and why? Link to the related issue or roadmap item (e.g. "Closes #42" or "Implements RD-001"). -->

## Test plan

- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] Manually tested in browser

## Notes

<!-- Anything reviewers should pay attention to: edge cases, breaking changes, follow-up work. -->
