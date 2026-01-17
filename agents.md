# Agents

- My preference is for you to answer quickly. Do the research you need but dont get carried away doing long tasks
- If you have multiple steps aska. question to ensure you keep on track. 
- Install deps with `bun install`, then run `bun dev --hot` for hot reloads while editing. Use `bun start` when you want the production-like server.
- Primary files: `src/server.ts` (Bun server, HTML rendering, inline client script) and `src/db.ts` (SQLite helpers). Static assets live in `public/`. The SQLite file is created automatically; reset with `bun run reset-db` if needed.

## Dual Database Architecture - CRITICAL

**Personal tasks and Team tasks use DIFFERENT code paths:**

| What | Personal | Team |
|------|----------|------|
| Database | `src/db.ts` | `src/team-db.ts` (TeamDatabase class) |
| Schema | `src/db.ts` (inline) | `src/team-schema.ts` |
| Routes | `src/routes/todos.ts` | `src/routes/team-todos.ts` |
| Services | `src/services/todos.ts` | (inline in team routes) |
| DB Files | `marginal-gains.sqlite` | `data/teams/<slug>.sqlite` |

**When adding/fixing todo features, you MUST update BOTH paths!**

Common bugs from forgetting this:
- Missing columns in team schema (e.g., `updated_at`)
- Missing methods in TeamDatabase class (e.g., `updateTodoPosition`)
- Missing parameters in team update methods (e.g., `assignedTo`)

The `db-router.ts` manages team database connections with LRU caching.
- For current layout and where logic lives, see `docs/structure.md` (routes, services, rendering, config).
- When mutating client-side state in the inline script, call `refreshUI()` so the login controls, hero input, and other UI panels redraw correctly.
- Keep the existing routes and forms intact (`/todos`, `/todos/:id/update`, `/todos/:id/state`, `/todos/:id/delete`, `/auth/login`, `/auth/logout`) to avoid breaking submissions.
- Always check for syntax errors before submitting changes by running the app locally and watching the console output.
- Always check for type errors before finishing the job.
- Ensure you always review links to images when presented in a prompt.
- Run lint before shipping: `bun run lint` (use `bun run lint:fix` for autofixes) and keep commits clean.
- Lint enforces async/import hygiene (no floating promises, ordered imports) and parses inline `<script>` blocks for syntax errors; fix warnings instead of silencing them.
- Commit every change with a clear message so rollbacks stay easy, and avoid touching unrelated local edits.
- Make a note of current commit before starting and after a change has completed
- For schema and ownership details, consult `docs/data_model.md` before changing queries or migrations.
- For AI agent interactions (fetching tasks, posting summaries), follow `docs/agent_api_spec.md` for endpoints, payloads, and example curls.
- For UI changes (structure, refresh flow, styling hooks), see `docs/ui.md` to quickly find component markup, state update patterns, and styling entry points.
- **Debug Logs**: Client-side logs (NostrConnect, Bunker, Auth) are written to `tmp/logs/session.log`. Logs are cleared on each server start. Inspect with `cat tmp/logs/session.log` or `curl http://localhost:3000/api/debug/log`. Use this to debug Nostr Connect and bunker session issues.

## Client-Side Reactivity Pattern

For UI components needing reactive updates without page reloads (e.g., kanban board), use **Alpine.js + Dexie.js**:

- **Alpine.js**: Lightweight reactive directives (`x-data`, `x-for`, `x-on`) for enhancing server-rendered HTML
- **Dexie.js**: IndexedDB wrapper for browser-side state persistence

**Important distinctions:**
- Dexie.js = **browser-only** IndexedDB (client state cache)
- `src/db.ts` = **server-side** SQLite (source of truth)
- These are completely separate - Dexie does NOT modify server SQLite

**File locations:**
- `public/lib/` - Alpine.js, Dexie.js libraries
- `public/db/` - Dexie schemas (browser IndexedDB)
- `public/stores/` - Alpine stores with server sync logic

**Pattern:** Server renders HTML → Alpine hydrates + populates IndexedDB → User actions update IndexedDB (optimistic) → Sync service pushes to `/api/*` endpoints → Server SQLite updated

When building reactive components, follow this pattern rather than full page reloads.
