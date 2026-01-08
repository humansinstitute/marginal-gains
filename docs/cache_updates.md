# Cache Updates: Profile Caching

## Current State

Profiles are cached separately from other data:
- **Storage:** localStorage (`mg_profile_cache`)
- **Expiry:** 1 hour TTL
- **Location:** `public/avatar.js`

### Current Flow
1. `fetchProfile(pubkey)` checks in-memory `profileCache` Map
2. If expired (>1hr), fetches Kind 0 from Nostr relays
3. Saves to `profileCache` Map + localStorage
4. Also saves to server DB via `POST /chat/users`

---

## Proposed Changes

### 1. Move Profile Cache to IndexedDB

Add `profiles` store to `public/localDb.js`:

```javascript
// In onupgradeneeded (bump DB_VERSION)
if (!database.objectStoreNames.contains("profiles")) {
  const profileStore = database.createObjectStore("profiles", { keyPath: "pubkey" });
  profileStore.createIndex("fetchedAt", "fetchedAt", { unique: false });
}
```

Add CRUD functions:
```javascript
export async function saveProfile(profile) { ... }
export async function getProfile(pubkey) { ... }
export async function getAllProfiles() { ... }
```

### 2. Update avatar.js to Use IndexedDB

Replace localStorage calls with IndexedDB:

```javascript
import { saveProfile, getProfile } from "./localDb.js";

export async function fetchProfile(pubkey) {
  // Check IndexedDB cache first
  const cached = await getProfile(pubkey);
  if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < 3600000) {
    return cached;
  }

  // ... fetch from relays ...

  // Save to IndexedDB instead of localStorage
  await saveProfile(profile);
  return profile;
}
```

### 3. Prefetch Visible Profiles

In `chat.js`, batch-load profiles for visible messages:

```javascript
async function prefetchProfiles(messages) {
  const pubkeys = [...new Set(messages.map(m => m.authorPubkey))];

  // Load from cache first
  const cached = await Promise.all(pubkeys.map(getProfile));
  const missing = pubkeys.filter((pk, i) => !cached[i] || isExpired(cached[i]));

  // Fetch missing in parallel (throttled)
  await Promise.all(missing.slice(0, 10).map(fetchProfile));
}
```

### 4. SSE Broadcast for Profile Updates

When a user updates their profile, broadcast to connected clients:

**Server (`src/services/events.ts`):**
```typescript
export type EventType = ... | "profile:update";
```

**Server (`src/routes/chat.ts`):**
```typescript
// In handleUpdateUser
broadcast({
  type: "profile:update",
  data: { profile: updatedUser },
});
```

**Client (`public/liveUpdates.js`):**
```javascript
eventSource.addEventListener("profile:update", async (event) => {
  const { profile } = JSON.parse(event.data);
  await saveProfile({ ...profile, fetchedAt: Date.now() });
  refreshUI(); // Re-render messages with updated name/picture
});
```

---

## Benefits

1. **Unified storage** - All cached data in IndexedDB (not split across localStorage)
2. **Larger capacity** - IndexedDB has much higher limits than localStorage
3. **Offline profiles** - Names/pictures available offline
4. **Real-time sync** - Profile changes propagate to all viewers
5. **Faster renders** - No need to fetch profiles on every page load

---

## Migration

On first load after upgrade:
1. Check for existing localStorage profile cache
2. Migrate to IndexedDB
3. Delete localStorage entry

```javascript
async function migrateProfileCache() {
  const old = localStorage.getItem("mg_profile_cache");
  if (!old) return;

  const profiles = JSON.parse(old);
  for (const [pubkey, profile] of Object.entries(profiles)) {
    await saveProfile({ ...profile, pubkey });
  }

  localStorage.removeItem("mg_profile_cache");
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `public/localDb.js` | Add `profiles` store + CRUD |
| `public/avatar.js` | Use IndexedDB instead of localStorage |
| `public/chat.js` | Batch prefetch profiles for messages |
| `src/services/events.ts` | Add `profile:update` event type |
| `src/routes/chat.ts` | Broadcast on profile update |
| `public/liveUpdates.js` | Handle `profile:update` SSE event |
