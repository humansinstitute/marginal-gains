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

**Multi-Tenant Database Architecture**

The app uses a multi-tenant architecture with separate databases per team:

```
┌─────────────────────────────────────────────────────────────┐
│  Master Database (src/db.ts)                                │
│  File: marginal-gains.sqlite                                │
│  - Team registry (list of all teams)                        │
│  - Team memberships                                         │
│  - Global user directory                                    │
│  - (deprecated: personal todos table - no longer used)      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Team "foo" DB   │  │ Team "bar" DB   │  │ Team "baz" DB   │
│ (team-db.ts)    │  │ (team-db.ts)    │  │ (team-db.ts)    │
│ - Todos         │  │ - Todos         │  │ - Todos         │
│ - Chat          │  │ - Chat          │  │ - Chat          │
│ - Groups        │  │ - Groups        │  │ - Groups        │
└─────────────────┘  └─────────────────┘  └─────────────────┘
  data/teams/foo.sqlite  data/teams/bar.sqlite  etc.
```

**Todos are TEAM-ONLY:**

Todos exist exclusively in team databases. There are no personal todos.

| Component | Location |
|-----------|----------|
| Database | `src/team-db.ts` (TeamDatabase class) |
| Schema | `src/team-schema.ts` |
| Routes | `src/routes/team-todos.ts` |

**Note:** Legacy personal todo code (`src/routes/todos.ts`, `src/services/todos.ts`) is deprecated and scheduled for removal. See `docs/remediate_todo.md` for cleanup plan.

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

## Front End Architecture: Dexie + Alpine

### Core Stack
- **Dexie.js** — All client state lives in IndexedDB via Dexie
- **Alpine.js** — Reactive UI binds directly to Dexie queries
- **Backend DB** — SQLite as source of truth

### State Management
- Browser state is Dexie-first; never store app state in memory-only variables
- UI reactivity comes from Alpine watching Dexie liveQueries
- All user-facing data reads come from Dexie, not direct API responses

### Secrets & Keys
- Store keys/passwords/tokens **encrypted** in IndexedDB
- Encrypt with a key derived from user passphrase (e.g., PBKDF2 + AES-GCM)
- Never store plaintext secrets; decrypt only when needed in memory

### Sync Strategy

#### Real-time (WebSocket or SSE)
- Maintain persistent connection for server→client pushes
- On receiving update: upsert into Dexie, Alpine reactivity handles UI
- Client→server writes go via WebSocket message or REST POST

#### Page Load / Refresh
- `GET /sync?since={lastSyncTimestamp}` — pull changes since last sync
- `POST /sync` — push local unsynced changes (track with `syncedAt` or dirty flag)
- Resolve conflicts with last-write-wins or server-authoritative merge

#### Offline Handling
- Queue mutations in Dexie with `pending: true` flag
- On reconnect: flush pending queue to server, then pull latest

### Dexie Schema Conventions
```javascript
db.version(1).stores({
  items: '++id, visitorId, [syncedAt+id], *tags',
  secrets: 'id',           // encrypted blobs
  syncMeta: 'key'          // lastSyncTimestamp, etc.
});
```

### Alpine Integration Pattern
```javascript
// Expose Dexie liveQuery to Alpine
Alpine.store('items', {
  list: [],
  async init() {
    liveQuery(() => db.items.toArray())
      .subscribe(items => this.list = items);
  }
});
```

```html
<div x-data x-init="$store.items.init()">
  <template x-for="item in $store.items.list" :key="item.id">
    <div x-text="item.name"></div>
  </template>
</div>
```

### File structure for reactive components:
- `public/lib/` - Alpine.js and Dexie.js libraries
- `public/db/` - Dexie database schemas (client-side only)
- `public/stores/` - Alpine stores with sync logic

### Rules
- No raw `fetch` results displayed directly — always write to Dexie first
- All sensitive data encrypted at rest in IndexedDB
- Sync timestamps on every record for incremental sync
- WebSocket/SSE for live updates; REST fallback on reconnect/refresh
