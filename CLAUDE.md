# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun install          # Install dependencies
bun dev              # Run dev server with hot reload (port 3000 default)
bun start            # Same as dev
bun run lint         # ESLint + inline JS syntax check
bun run lint:fix     # Auto-fix lint issues
bun run reset-db     # Delete SQLite database
bun test             # Run tests with bun:test
```

Single test file: `bun test tests/app.test.ts`

## Architecture Overview

**Marginal Gains** is a self-hosted Slack-like chat app with Nostr ID authentication. Users sign in with Nostr browser extensions (nos2x, Alby) - no email/password needed.

### Tech Stack
- **Runtime**: Bun (not Node.js)
- **Database**: SQLite via `bun:sqlite`
- **Auth**: Nostr NIP-07/NIP-98 event signatures
- **Frontend**: Vanilla JS ES modules (no bundler)
- **Real-time**: Server-Sent Events (SSE)

### Server Architecture

The server (`src/server.ts`) is a single Bun.serve() with pattern-matched routing. No framework - routes are matched via regex against pathname.

**Request flow:**
1. `server.ts` matches route pattern
2. Extracts session from cookie via `AuthService`
3. Calls route handler from `src/routes/`
4. Route handlers use `src/db.ts` for data access

**Key directories:**
- `src/routes/` - HTTP handlers (auth, chat, groups, push, etc.)
- `src/services/` - Business logic (auth session management, SSE events, push notifications)
- `src/render/` - Server-side HTML generation (returns template strings)
- `public/` - Client-side JS modules served as static files

### Database Layer

**IMPORTANT: Dual Database Architecture**

The app uses a multi-tenant architecture with TWO separate database systems:

```
┌─────────────────────────────────────────────────────────────┐
│  Master Database (src/db.ts)                                │
│  File: marginal-gains.sqlite                                │
│  - Personal todos (no team)                                 │
│  - Team registry (list of all teams)                        │
│  - Team memberships                                         │
│  - Global user directory                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Team "foo" DB   │  │ Team "bar" DB   │  │ Team "baz" DB   │
│ (team-db.ts)    │  │ (team-db.ts)    │  │ (team-db.ts)    │
│ - Team todos    │  │ - Team todos    │  │ - Team todos    │
│ - Team chat     │  │ - Team chat     │  │ - Team chat     │
│ - Team groups   │  │ - Team groups   │  │ - Team groups   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
  data/teams/foo.sqlite  data/teams/bar.sqlite  etc.
```

**Code Duplication - CRITICAL:**

| Component | Personal Tasks | Team Tasks |
|-----------|---------------|------------|
| Database | `src/db.ts` (prepared statements) | `src/team-db.ts` (TeamDatabase class) |
| Schema | `src/db.ts` (inline migrations) | `src/team-schema.ts` |
| Routes | `src/routes/todos.ts` | `src/routes/team-todos.ts` |
| Services | `src/services/todos.ts` | (logic inline in team routes) |

**When adding todo features, you MUST update BOTH:**
1. `src/db.ts` + `src/services/todos.ts` + `src/routes/todos.ts` (personal)
2. `src/team-db.ts` + `src/team-schema.ts` + `src/routes/team-todos.ts` (team)

The `db-router.ts` manages connections to team databases (cached, LRU eviction).

### Authentication

`AuthService` (`src/services/auth.ts`) manages in-memory sessions. Login validates a signed Nostr event (kind 27235) with app tag and method tag. Session token stored in cookie.

Login methods: `extension` (NIP-07 browser extension) or `ephemeral` (generated keypair with optional PIN encryption).

### Real-time Updates

`src/services/events.ts` provides SSE-based live updates. Clients connect to `/chat/events` and receive message/channel events.

### Admin Access

Set `ADMIN_NPUBS` env var (comma-separated npub addresses). Admin check via `isAdmin()` in `src/config.ts`.

## Linting

ESLint config enforces:
- TypeScript strict mode
- `type` imports preferred
- No floating promises (`@typescript-eslint/no-floating-promises: error`)
- Import ordering with newlines between groups

The lint script also runs `scripts/check-inline-js.js` which extracts `<script>` blocks from server templates and validates their JS syntax.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | - | Set `production` for secure cookies |
| `ADMIN_NPUBS` | - | Comma-separated admin npub addresses |
| `DB_PATH` | `marginal-gains.sqlite` | SQLite database path |
| `PUSH_CONTACT_EMAIL` | `admin@example.com` | Web push contact |

## Debug Logging

Client-side debug logs are written to `tmp/logs/session.log`. The log file is cleared on each server start.

**Inspecting logs:**
```bash
# Read the log file directly
cat tmp/logs/session.log

# Watch logs in real-time
tail -f tmp/logs/session.log

# Or fetch via API
curl http://localhost:3000/api/debug/log
```

**Log prefixes:**
- `[NostrConnect]` - QR code / NIP-46 connection flow
- `[Bunker]` - Bunker URI and auto-login flow
- `[Auth]` - Session validation and general auth

The debug logger is in `public/debugLog.js`. Server endpoint is `src/routes/debug.ts`.

## Cryptography

Use `nostr-tools` for all Nostr cryptography (key generation, event signing, verification). The `@noble/*` and `@scure/*` packages are transitive dependencies.

## Client-Side Reactivity (Alpine.js + Dexie.js)

For components requiring reactive UI updates without full page reloads (e.g., kanban board), we use:

- **Alpine.js** (~17kb) - Lightweight reactive framework for enhancing server-rendered HTML
- **Dexie.js** (~25kb) - IndexedDB wrapper for client-side state persistence

### Architecture

```
Browser (IndexedDB/Dexie)          Server (SQLite)
┌─────────────────────────┐        ┌─────────────────────────┐
│  public/db/*.js         │        │  src/db.ts              │
│  Local cache for fast   │──HTTP──│  Source of truth        │
│  UI updates             │  API   │  (unchanged)            │
└─────────────────────────┘        └─────────────────────────┘
```

**Key points:**
- Dexie.js is **browser-only** (IndexedDB) - it does NOT touch server-side SQLite
- Server SQLite (`src/db.ts`) remains the source of truth
- Client syncs to server via existing `/api/*` endpoints
- Enables: instant UI updates, offline support, cross-tab sync

### File structure for reactive components:
- `public/lib/` - Alpine.js and Dexie.js libraries
- `public/db/` - Dexie database schemas (client-side only)
- `public/stores/` - Alpine stores with sync logic

### Pattern:
1. Server renders initial HTML with data
2. Alpine hydrates UI and populates local IndexedDB
3. User actions update IndexedDB first (optimistic)
4. Sync service pushes changes to server API
5. On conflict/error, refresh from server
