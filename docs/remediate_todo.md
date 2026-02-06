# Todo Code Cleanup Plan

## Status: COMPLETED

**Completed:** February 2026

Personal (non-team) todo code has been removed. All todo functionality now lives at the team level only.

## What Was Removed

### Deleted Files
- `src/routes/todos.ts` - Personal todo route handlers

### Cleaned Up Files
- `src/server.ts` - Removed personal todo imports and route handlers
- `src/routes/home.ts` - Removed `handleTodos()` and `handleTodosRedirect()`, unused imports
- `src/services/todos.ts` - Removed ~18 dead functions (personal todo CRUD, group todo CRUD via master DB)
- `src/render/home.ts` - Removed `renderHomePage()` and all personal-only rendering functions

### What Was Kept
- `src/services/todos.ts` retains: `canManageGroupTodo`, `createTodosFromTasks`, `latestSummaries`, `listOwnerScheduled`, `listOwnerUnscheduled`, `normalizeSummaryText`, `persistSummary` (used by `routes/ai.ts` and `routes/tasks.ts`)
- `src/render/home.ts` retains: `renderTeamTodosPage` and all team-scoped rendering functions
- `src/routes/home.ts` retains: `handleHome`, `ViewMode` type export

## Database Notes

The master database (`marginal-gains.sqlite`) may still contain a `todos` table. This table is deprecated but remains for historical data.

**Team todos** are stored in per-team SQLite files: `data/teams/<slug>.sqlite`
