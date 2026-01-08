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

`src/db.ts` contains all SQLite schema definitions and query functions. Schema auto-creates on first run. Key tables: channels, messages, users, groups, group_members, channel_groups, push_subscriptions, todos.

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
