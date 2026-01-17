# Todo Code Cleanup Plan

## Status: DEFERRED

This document describes deprecated personal todo code to be removed after a testing period. **Do not execute this cleanup until explicitly requested.**

## Background

Todos now exist ONLY at the team level. The personal (non-team) todo functionality is deprecated and should be removed after verifying no regressions.

---

## Code to Remove

### 1. Route File: `src/routes/todos.ts`
**Action:** DELETE entire file

Contains personal todo handlers that are no longer used:
- `handleTodoCreate`
- `handleTodoUpdate`
- `handleTodoDelete`
- `handleTodoState`
- `handleApiTodoState`
- `handleApiTodoPosition`
- `handleCreateSubtask`
- `handleGetSubtasks`
- `handleHasSubtasks`

### 2. Server Routes: `src/server.ts`

**Remove imports (around line 29-40):**
```typescript
import {
  handleApiTodoPosition,
  handleApiTodoState,
  handleCreateSubtask,
  handleGetSubtasks,
  handleHasSubtasks,
  handleTodoCreate,
  handleTodoDelete,
  handleTodoState,
  handleTodoUpdate,
} from "./routes/todos";
```

**Remove route handlers (around lines 485-487):**
```typescript
// Personal todo routes - no longer used
```

**Remove route handlers (around lines 794-815):**
- `/todo` routes
- `/todos` routes (non-team)
- `/api/todos/*` routes (non-team)

### 3. Home Route: `src/routes/home.ts`

**Remove functions:**
- `handleTodos` - personal todos page handler
- `handleTodosRedirect` - redirect handler

### 4. Services: `src/services/todos.ts`

**Remove personal todo functions:**
- Functions that operate on master database todos
- Keep any shared utilities if used by team-todos

### 5. Render: `src/render/home.ts`

**Remove functions:**
- Personal todo rendering functions
- Keep team-related rendering

---

## Verification Steps (Before Removal)

1. **Confirm team todos work correctly:**
   ```bash
   # Test team todo CRUD operations
   curl http://localhost:3000/team/<slug>/todos
   ```

2. **Check for any remaining personal todo routes:**
   ```bash
   grep -r "handleTodo" src/ --include="*.ts" | grep -v team
   ```

3. **Verify no clients call deprecated endpoints:**
   ```bash
   grep -r "/todos" public/ --include="*.js"
   grep -r '"/todo' src/ --include="*.ts"
   ```

4. **Run full test suite:**
   ```bash
   bun test
   ```

5. **Run lint:**
   ```bash
   bun run lint
   ```

---

## Database Notes

The master database (`marginal-gains.sqlite`) may still contain a `todos` table. This table is deprecated but can remain for historical data. The schema in `src/db.ts` that creates this table can be removed, but the table itself does not need to be dropped.

**Team todos** are stored in per-team SQLite files: `data/teams/<slug>.sqlite`

---

## Execution Checklist

When ready to execute cleanup:

- [ ] Backup current state: `git stash` or create branch
- [ ] Remove `src/routes/todos.ts`
- [ ] Remove imports from `src/server.ts`
- [ ] Remove route handlers from `src/server.ts`
- [ ] Remove functions from `src/routes/home.ts`
- [ ] Clean up `src/services/todos.ts`
- [ ] Clean up `src/render/home.ts`
- [ ] Run `bun run lint:fix`
- [ ] Run `bun test`
- [ ] Manual testing of team todos
- [ ] Commit with message: "Remove deprecated personal todo code"

---

## Timeline

- **Created:** January 2025
- **Testing Period:** Run for a few days with team-only todos
- **Cleanup Target:** After confirming no issues with team-only architecture
