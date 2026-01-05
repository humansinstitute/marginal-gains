# Local Cache Implementation

## Overview

Cache all user data (chats, tasks, CRM) in browser IndexedDB for:
- **Instant display** - show cached data immediately on page load
- **Background refresh** - fetch fresh data silently after displaying cache
- **Offline read** - view cached data when offline (read-only)

## Current State

### Existing Infrastructure
- `public/localDb.js` - IndexedDB wrapper with stores for channels, messages, syncMeta
- `public/liveUpdates.js` - SSE client that saves messages/channels to IndexedDB
- `public/state.js` - Central state management with reactive `onRefresh()` callbacks

### What's Missing
1. **Messages/Channels** - Cached but not cache-first display (fetches fresh on load)
2. **Todos/Tasks** - Not cached, not broadcast via SSE
3. **CRM** - Not cached, not broadcast via SSE

---

## Phase 1: Extend IndexedDB Schema

**File:** `public/localDb.js`

1. Bump `DB_VERSION` from 1 to 2
2. Add new object stores in `onupgradeneeded`:
   - `todos` - keyPath: "id", indexes: owner, group_id, state
   - `crm_companies` - keyPath: "id"
   - `crm_contacts` - keyPath: "id", indexes: company_id
   - `crm_opportunities` - keyPath: "id", indexes: company_id, contact_id
   - `crm_activities` - keyPath: "id", indexes: contact_id, opportunity_id
3. Add CRUD functions for each store
4. Update `clearAllData()` to include new stores

---

## Phase 2: Add SSE Broadcasts for Todos

**Files:** `src/services/events.ts`, `src/routes/todos.ts`

1. Add event types to `EventType` union:
   ```typescript
   | "todo:new" | "todo:update" | "todo:delete"
   ```

2. In `src/routes/todos.ts`, import `broadcast` and call after CRUD:
   - After create: `broadcast({ type: "todo:new", data: { todo }, recipientNpubs: [...] })`
   - After update/state change: `broadcast({ type: "todo:update", ... })`
   - After delete: `broadcast({ type: "todo:delete", ... })`

3. Add helper in `src/db.ts`:
   ```typescript
   export function getGroupMemberNpubs(groupId: number): string[]
   ```

---

## Phase 3: Add SSE Broadcasts for CRM

**Files:** `src/services/events.ts`, `src/routes/crm.ts`

1. Add CRM event types:
   ```typescript
   | "crm:company:new" | "crm:company:update" | "crm:company:delete"
   | "crm:contact:new" | "crm:contact:update" | "crm:contact:delete"
   | "crm:opportunity:new" | "crm:opportunity:update" | "crm:opportunity:delete"
   | "crm:activity:new" | "crm:activity:update" | "crm:activity:delete"
   ```

2. Add broadcast calls to CRM route handlers

---

## Phase 4: Handle SSE Events in Client

**File:** `public/liveUpdates.js`

1. Register handlers for new event types
2. On todo/CRM events:
   - Save to IndexedDB
   - Trigger UI refresh via `refreshUI()` or custom event

---

## Phase 5: Cache-First Pattern for Chat

**File:** `public/chat.js`

Modify `fetchMessages()` and `fetchChannels()`:

```javascript
async function fetchMessages(channelId) {
  // 1. Load cached immediately
  const cached = await getMessagesForChannel(channelId);
  if (cached.length > 0) {
    setChannelMessages(channelId, cached.map(transform));
  }

  // 2. Fetch fresh in background
  const fresh = await fetch(`/chat/channels/${channelId}/messages`).then(r => r.json());
  await saveMessages(fresh, channelId);
  setChannelMessages(channelId, fresh.map(transform));
}
```

---

## Phase 6: Add Todo List API Endpoint

**Files:** `src/routes/todos.ts`, `src/server.ts`

Currently todos are server-rendered. Need JSON endpoint for client-side cache:

```typescript
// GET /api/todos?group_id=X
export async function handleListTodos(req, session) {
  const groupId = url.searchParams.get("group_id");
  const todos = groupId ? listTodosForGroup(groupId) : listOwnerTodos(session.npub);
  return jsonResponse(todos);
}
```

Add route in server.ts:
```typescript
if (pathname === "/api/todos") return handleListTodos(req, session);
```

---

## Phase 7: Cache-First for Kanban/Todos

**File:** `public/kanban.js` (or new `public/todoCache.js`)

1. On page load, render from IndexedDB cache
2. Fetch fresh and re-render
3. SSE keeps cache updated

---

## Phase 8: Offline Indicator

**File:** `public/liveUpdates.js`

```javascript
window.addEventListener("offline", () => emitEvent("connection:change", { state: "offline" }));
window.addEventListener("online", () => {
  emitEvent("connection:change", { state: "connecting" });
  connect();
});
```

Show banner in UI when offline.

---

## Files to Modify

| File | Changes |
|------|---------|
| `public/localDb.js` | Add stores, bump version, add CRUD |
| `src/services/events.ts` | Add todo/CRM event types |
| `src/routes/todos.ts` | Add broadcasts + GET /api/todos |
| `src/routes/crm.ts` | Add broadcasts |
| `src/server.ts` | Add /api/todos route |
| `public/liveUpdates.js` | Handle todo/CRM events, offline detection |
| `public/chat.js` | Cache-first in fetchMessages/fetchChannels |
| `public/kanban.js` | Cache-first todo loading |
| `public/crm.js` | Cache-first CRM loading |

---

## Implementation Order

1. Extend localDb.js schema
2. Add SSE broadcasts (todos first, then CRM)
3. Update liveUpdates.js handlers
4. Implement cache-first in chat.js
5. Add /api/todos endpoint
6. Implement cache-first in kanban.js
7. Implement cache-first in crm.js
8. Add offline indicator

---

## Testing Checklist

- [ ] Messages load from cache instantly on channel select
- [ ] Fresh messages appear after background fetch
- [ ] SSE updates save to IndexedDB
- [ ] Todos sync via SSE (new, update, delete)
- [ ] Kanban drag-drop updates broadcast to all viewers
- [ ] CRM changes sync via SSE
- [ ] Cache is cleared on logout
- [ ] Offline mode shows cached data with indicator
- [ ] No duplicate messages after SSE + fetch
