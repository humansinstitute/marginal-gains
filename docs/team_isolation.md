# Multi-Tenant Team Isolation Architecture

## Overview

Transform Marginal Gains from a single-instance app into a multi-tenant SaaS where team owners can create isolated team spaces, each with their own channels, groups, todos, and DMs.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data isolation | Separate SQLite per team | Complete isolation, simpler queries, no cross-team leakage risk |
| Multi-team users | Supported | Users can belong to multiple teams with a team selector |
| Admin model | Super-admins + team managers | ADMIN_NPUBS are super-admins; team owners/managers manage their teams |
| Migration | Current data → 'MarginalGains' team | Existing users become members of first team |

---

## Database Architecture

### Master Database (`data/master.sqlite`)

Stores team registry, memberships, and global user directory.

```sql
-- Team registry
CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,           -- URL-safe: 'marginalgains'
  display_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL,            -- npub of creator
  is_active INTEGER DEFAULT 1
);

-- Team memberships
CREATE TABLE team_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_npub TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'manager', 'member'
  invited_by TEXT,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, user_npub)
);

-- Global user directory (minimal - full profile lives in team DBs)
CREATE TABLE users_global (
  npub TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  display_name TEXT,
  picture TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Team invitations
CREATE TABLE team_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  single_use INTEGER DEFAULT 1,
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  redeemed_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
```

### Team Databases (`data/teams/{slug}.sqlite`)

Each team gets the **full existing schema** (channels, messages, groups, todos, CRM, etc.) - completely isolated.

---

## Encryption Model

### How Encryption Works Across Teams

The encryption model works naturally with multi-tenancy:

1. **User identity is global** - Your npub/pubkey is the same across all teams
2. **Channel keys are per-team** - Each team's `user_channel_keys` table is in its isolated team DB
3. **No key collision** - Team A's channel 1 and Team B's channel 1 are completely separate databases
4. **Same encryption flow** - When you enter a team, you query that team's DB for your encrypted channel keys

```
User: npub1abc... (same identity everywhere)

Team A DB (data/teams/teamA.sqlite)
├── user_channel_keys:
│   └── { user_pubkey: abc..., channel_id: 1, encrypted_key: KEY_A1 }
├── channels:
│   └── { id: 1, name: "general", encrypted: 1 }
└── community_keys:
    └── { user_pubkey: abc..., encrypted_key: COMMUNITY_KEY_A }

Team B DB (data/teams/teamB.sqlite)
├── user_channel_keys:
│   └── { user_pubkey: abc..., channel_id: 1, encrypted_key: KEY_B1 }
├── channels:
│   └── { id: 1, name: "general", encrypted: 1 }
└── community_keys:
    └── { user_pubkey: abc..., encrypted_key: COMMUNITY_KEY_B }
```

### Key Points

- **Session holds identity only** - Your session stores `npub` and `pubkey`, not encrypted keys
- **Keys fetched per-team** - When you switch to a team, the client fetches your encrypted channel keys from that team's database
- **Independent key distribution** - Each team has its own `community_keys` table for onboarding
- **No cross-team key sharing** - Teams are completely isolated at the encryption level
- **Same NIP-44 encryption** - Key wrapping uses the same Nostr encryption regardless of team

### Invite Flow Per Team

Each team manages its own invite codes and community key distribution:

1. Team manager creates invite code → stored in team's `invite_codes` table
2. New user redeems code → gets team's community key
3. Community key used to bootstrap channel key distribution within that team
4. User can repeat this process for each team they join

---

## Routing Architecture

### Team Context Strategy

**Session-based team selector** with deep link support:

1. Session stores `currentTeamId` and `currentTeamSlug`
2. **Team selector dropdown** (first item in menu) for multi-team users
3. **Deep links**: `/t/{team-slug}/chat` auto-switches team and redirects
4. **API header**: `X-Team-Id` for explicit team targeting

### URL Patterns

```
# Team-scoped routes (require team context)
/t/{slug}/chat                    → Chat page for team
/t/{slug}/chat/channel/{name}     → Deep link to channel
/t/{slug}/todo                    → Team todos
/t/{slug}/crm                     → Team CRM
/t/{slug}/settings                → Team settings (managers only)

# Team management routes (no team context needed)
/teams                            → List user's teams
/teams/create                     → Create new team (managers/super-admins)
/teams/join/{code}                → Join team via invite

# Auth routes (unchanged)
/auth/login
/auth/logout
```

---

## Permission Model

| Role | Scope | Capabilities |
|------|-------|--------------|
| Super-admin | All teams | Create/delete teams, access any team, promote team managers |
| Team owner | Single team | Full team control, delete team, promote managers |
| Team manager | Single team | Manage groups/channels, invite members |
| Team member | Single team | Standard access per group permissions |

### team_managers Group

A special group in the master context (not per-team) that controls who can create new teams:

- Super-admins can add npubs to `team_managers`
- Members of `team_managers` can create new teams
- When creating a team, the creator becomes team owner

---

## Implementation Plan

### Phase 1: Infrastructure (Foundation)

**1.1 Create database routing layer**
- New file: `src/db-router.ts`
- Master DB singleton with schema initialization
- Team DB connection cache (LRU, max 10 connections)
- Functions: `getMasterDb()`, `getTeamDb(slug)`

**1.2 Create request context**
- New file: `src/context.ts`
- `RequestContext` type: `{ session, teamDb, masterDb, teamSlug }`
- Factory: `createContext(session)` resolves team DB from session

**1.3 Extend session with team context**
- Modify: `src/services/auth.ts`
- Add to Session: `currentTeamId`, `currentTeamSlug`, `teamMemberships[]`
- On login: query master DB for user's teams, auto-select if single team
- New method: `switchTeam(token, teamId)`

### Phase 2: Master DB Operations

**2.1 Team CRUD operations**
- New file: `src/master-db.ts`
- Functions: `createTeam()`, `getTeam()`, `listTeams()`, `updateTeam()`, `deleteTeam()`
- Team membership functions: `addTeamMember()`, `removeTeamMember()`, `getTeamMembers()`
- User team queries: `getUserTeams(npub)`, `isTeamMember()`, `getTeamRole()`

**2.2 Team invitation system**
- Functions: `createTeamInvitation()`, `redeemTeamInvitation()`
- Reuse existing invite code pattern from `invite_codes` table

### Phase 3: Server Routing Changes

**3.1 Add team context middleware**
- Modify: `src/server.ts`
- Extract team context before routing
- Routes without team context: `/auth/*`, `/teams`, `/teams/create`, `/teams/join/*`
- Redirect to `/teams` if logged in but no team selected

**3.2 Team management routes**
- New file: `src/routes/teams.ts`
- `GET /teams` - list user's teams
- `POST /teams` - create new team (requires team_managers membership or super-admin)
- `GET /t/:slug/settings` - team settings page
- `POST /t/:slug/invite` - generate invite link
- `POST /teams/switch` - switch current team
- Deep link handlers for `/t/:slug/*`

### Phase 4: Database Refactoring

**4.1 Refactor db.ts to dependency injection**
- Create: `src/team-db.ts`
- `TeamDatabase` class wrapping all current db.ts functions
- Constructor takes `Database` instance
- All exported functions become methods
- Keep `src/db.ts` as compatibility layer initially

**4.2 Update route handlers**
- Modify all files in `src/routes/`
- Handlers receive `RequestContext` instead of just `Session`
- Use `ctx.teamDb` via `TeamDatabase` class

### Phase 5: Real-time Updates

**5.1 Namespace SSE by team**
- Modify: `src/services/events.ts`
- Change: `Map<npub, Client>` → `Map<teamSlug, Map<npub, Client>>`
- `registerClient(teamSlug, npub, controller)`
- `broadcast(teamSlug, event)` - only sends to team's clients

### Phase 6: UI Changes

**6.1 Team selector component**
- Modify: `src/render/components.ts` (header)
- **First item in menu** - dropdown showing current team
- List of user's teams with switch action
- "Manage Teams" link

**6.2 Teams page**
- New render: `src/render/teams.ts`
- List teams with roles, create team button, pending invites

**6.3 Team settings page**
- New render: `src/render/team-settings.ts`
- Name/description/icon editing
- Member list with role management
- Invite link generation
- Danger zone (delete team - owner only)

**6.4 Client-side state**
- Modify: `public/state.js`
- Add `state.teams = { current, available }`
- Team switching resets chat state and reconnects SSE

### Phase 7: Migration

**7.1 Migration script**
- New file: `scripts/migrate-to-multitenancy.ts`
- Create `data/` and `data/teams/` directories
- Initialize master.sqlite with schema
- Copy existing `marginal-gains.sqlite` to `data/teams/marginalgains.sqlite`
- Create 'marginalgains' team in master DB
- Import existing users as team members
- Promote ADMIN_NPUBS to team owners

---

## Critical Files

| File | Change Type | Description |
|------|-------------|-------------|
| `src/db-router.ts` | New | Master DB + team DB routing |
| `src/context.ts` | New | Request context with team DB |
| `src/master-db.ts` | New | Master DB operations |
| `src/team-db.ts` | New | TeamDatabase class (refactored db.ts) |
| `src/routes/teams.ts` | New | Team management routes |
| `src/render/teams.ts` | New | Teams page rendering |
| `src/server.ts` | Modify | Team context middleware |
| `src/services/auth.ts` | Modify | Session team context |
| `src/services/events.ts` | Modify | Team-scoped SSE |
| `src/db.ts` | Modify | Compatibility layer for TeamDatabase |
| `public/state.js` | Modify | Teams state management |

---

## Environment Variables

```bash
# New
MASTER_DB_PATH=data/master.sqlite
TEAMS_DB_DIR=data/teams

# Existing (unchanged meaning)
ADMIN_NPUBS=npub1...,npub2...  # Now super-admins across all teams
```

---

## Verification Plan

1. **Unit tests**: Add tests for master DB operations, team switching
2. **Migration test**: Run migration script on copy of prod data
3. **Manual testing**:
   - Create new team as super-admin
   - Invite user via invite code
   - Switch between teams
   - Verify data isolation (channels/messages don't leak)
   - Verify SSE events scoped to team
   - Verify encryption keys isolated per team
4. **Lint check**: `bun run lint`
