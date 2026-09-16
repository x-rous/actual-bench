<!--
  Target branch: main

  PR title: `type(scope): description`, user-facing — this becomes the changelog
  entry verbatim, and its type decides which section it lands in.
    ❌  wip stuff / fix bug / update things
    ✅  feat(budget): add schedules page with basic CRUD
    ✅  fix(rules): keep the drawer width correct behind Traefik

  Label: applied automatically from that type. The branch name has no bearing.
    feat:                                          → feature     → 🚀 Features
    fix:                                           → fix         → 🐛 Bug Fixes
    docs:                                          → docs        → 🔧 Maintenance
    chore: refactor: perf: build: ci: style: test: → maintenance → 🔧 Maintenance
    anything else                                  → none        → 📌 Uncategorised
-->

## Summary

<!-- What does this PR do and why? Link to the related issue or roadmap item (e.g. "Closes #42" or "Implements RD-001"). -->

## Test plan

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] Manually tested in browser

## Notes

<!-- Anything reviewers should pay attention to: edge cases, breaking changes, follow-up work. -->
