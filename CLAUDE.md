@AGENTS.md

## Active Technologies
- TypeScript 5 / Node 20 + Next.js 16 (Turbopack), React 19, TanStack Query 5, Zustand 5, TanStack Table 8, RHF 7 + Zod 4, Tailwind 4 (feat/001-budget-management-workspace)
- No persistent storage — server state via Budget Months API; client state in Zustand and TanStack Query cache (feat/001-budget-management-workspace)
- TypeScript 5 / Node 20 + Next.js 16 (Turbopack, app router), React 19, Zustand 5 (existing `staged.ts` store), TanStack Query 5 (existing `useRules` hook), Tailwind 4 (via `globals.css` `@theme`), shadcn/ui primitives already in `src/components/ui/` (002-rule-diagnostics)
- None — analysis runs entirely in-memory against the staged store and TanStack Query cache that are already loaded for the Rules page. No new API endpoints, no persistence. (002-rule-diagnostics)

## Recent Changes
- feat/001-budget-management-workspace: Added TypeScript 5 / Node 20 + Next.js 16 (Turbopack), React 19, TanStack Query 5, Zustand 5, TanStack Table 8, RHF 7 + Zod 4, Tailwind 4
- feat/001-budget-management-workspace: Shipped Budget Management Workspace (`/budget-management`) — staged cell editing, save review panel, bulk actions, CSV import/export, envelope-mode immediate actions. New `src/store/budgetEdits.ts` store for budget-specific undo/redo (separate from `staged.ts`). New `src/lib/budget/deriveBudgetMode.ts` shared utility (returns uppercase; `useBudgetMode` hook normalizes to lowercase).
