# End-to-End Encryption for Private Groups & DMs

## Overview

This document describes the encryption approach for private group messages and DMs in Marginal Gains. The goal is simple: **the server cannot read private message content**, while maintaining a straightforward implementation.

## Design Principles

1. **Server is untrusted for content** - Server stores only ciphertext for encrypted channels
2. **Server is trusted for access control** - Server still enforces who can access channels
3. **Backwards compatible** - Existing plaintext messages remain readable
4. **Simple key model** - One symmetric key per channel, wrapped per-user

## How It Works

### Channel Key Lifecycle

```
1. Owner creates a private channel
2. Owner's client generates a random symmetric key (AES-256-GCM)
3. Key is encrypted to owner's npub using NIP-44
4. Encrypted key blob stored in DB (user_channel_keys table)
```

### Adding Members

```
1. Owner invites a new member (by npub)
2. Owner's client decrypts the channel key from their key store
3. Owner's client re-encrypts the channel key to the new member's npub (NIP-44)
4. New encrypted key blob stored in DB for the new member
```

### Offline Invitation (Key Pre-Distribution)

A critical feature: **members don't need to be logged in to receive keys**.

Since NIP-44 encryption only requires the recipient's public key (npub), the owner can:
1. Invite a user by npub who has never logged into the app
2. Wrap the channel key to that npub immediately
3. Store the wrapped key in `user_channel_keys`

When the invited user eventually logs in:
1. They see the encrypted channel in their channel list
2. Client checks `user_channel_keys` for their pubkey
3. Finds the pre-distributed wrapped key
4. Decrypts it with their nsec (via extension or ephemeral key)
5. Can immediately read all encrypted messages

```
Owner                          Server                         New User (offline)
  │                              │                                │
  │─── Invite user by npub ─────▶│                                │
  │                              │── Add to channel_members ─────▶│
  │                              │                                │
  │─── Wrap key to npub ────────▶│                                │
  │    (NIP-44 encrypt)          │── Store in user_channel_keys ─▶│
  │                              │                                │
  │                              │         ... time passes ...    │
  │                              │                                │
  │                              │◀────────── User logs in ───────│
  │                              │                                │
  │                              │◀─── GET /channels/:id/keys ────│
  │                              │──── Return wrapped key ───────▶│
  │                              │                                │
  │                              │         User decrypts with nsec│
  │                              │         Can read all messages! │
```

This ensures seamless onboarding - no "waiting for key exchange" flow required.

### Sending Messages

```
1. Client retrieves their encrypted channel key from server
2. Client decrypts channel key using their Nostr private key
3. Client encrypts message content with symmetric channel key (AES-256-GCM)
4. Encrypted message sent to server with encrypted=1 flag
```

### Reading Messages

```
1. Client fetches messages from server
2. For each message where encrypted=1:
   - Decrypt channel key (cached after first use)
   - Decrypt message content with channel key
3. For messages where encrypted=0:
   - Display plaintext as-is (legacy messages)
```

## Data Model

### New Table: user_channel_keys

```sql
CREATE TABLE user_channel_keys (
  user_pubkey TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,  -- JSON structure with NIP-44 encrypted channel key
  key_version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_pubkey, channel_id, key_version)
);
```

### Key Storage Format (JSON)

The `encrypted_key` column stores a JSON structure:

```json
{
  "v": 1,
  "alg": "nip44",
  "key": "<base64 NIP-44 ciphertext>",
  "created_by": "<pubkey of user who wrapped this key>",
  "created_at": "<ISO timestamp>"
}
```

- `v` - Schema version for future-proofing
- `alg` - Algorithm used (always "nip44" for now)
- `key` - The channel symmetric key, NIP-44 encrypted to the recipient
- `created_by` - Who wrapped this key (owner or delegated inviter in future)
- `created_at` - When this key was issued

### Messages Table Changes

```sql
ALTER TABLE messages ADD COLUMN encrypted INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN key_version INTEGER DEFAULT NULL;
```

- `encrypted=0` - Plaintext (legacy or public channels)
- `encrypted=1` - Content is AES-256-GCM ciphertext, base64 encoded
- `key_version` - Which key version was used (for future key rotation)

## Encryption Algorithms

| Purpose | Algorithm | Library |
|---------|-----------|---------|
| Key wrapping (per-user) | NIP-44 | nostr-tools |
| Message encryption | AES-256-GCM | Web Crypto API |
| Key derivation | N/A (random generation) | Web Crypto API |

### Message Ciphertext Format

```
base64(nonce || ciphertext || tag)
```

- 12-byte random nonce
- Variable-length ciphertext
- 16-byte authentication tag

### Encrypted Payload Structure

Before encryption, the message is wrapped with sender authentication:

```json
{
  "content": "The actual message text",
  "sender": "<sender pubkey hex>",
  "ts": 1704067200,
  "sig": "<Nostr signature of content+ts by sender>"
}
```

This JSON is then encrypted with AES-256-GCM. On decryption, clients:
1. Decrypt the payload
2. Verify `sig` matches `content+ts` signed by `sender`
3. Reject if signature invalid (display as `[Unverified message]`)

**Why**: Prevents impersonation. Without this, anyone with the channel key could forge messages as any sender. The Nostr signature proves the message came from who it claims.

## Access Control

### Who Can Do What

| Action | Who |
|--------|-----|
| Create encrypted channel | Any user |
| Generate channel key | Channel owner (on creation) |
| Invite members | Channel owner only |
| Send messages | Any channel member |
| Read messages | Any channel member with key |

### Server's Role

The server **cannot**:
- Read encrypted message content
- Decrypt channel keys
- Forge messages (no key access)

The server **can**:
- Enforce channel membership (who can post/read)
- Store encrypted blobs
- Provide metadata for notifications (channel name, sender)
- Remove users from channels (though they retain old keys)

## Backwards Compatibility

### Migration Strategy

1. **No migration required** - Existing messages stay as-is
2. New `encrypted` column defaults to 0
3. Client checks `encrypted` flag before rendering
4. Public channels continue to work unchanged
5. Existing private channels can be "upgraded" by owner generating a key

### Client Logic

```javascript
async function renderMessage(message, channelId) {
  if (message.encrypted) {
    const channelKey = await getChannelKey(channelId, message.key_version);
    return decrypt(message.content, channelKey);
  }
  return message.content; // plaintext
}
```

## Channel Upgrade Flow (Public → Private/Encrypted)

A channel can be converted from public to private with encryption. This triggers a batch migration of existing messages.

### Upgrade Process

```
1. Owner enables encryption on an existing channel
2. Client generates new channel symmetric key
3. Client wraps key to owner's npub, stores in user_channel_keys
4. Client wraps key to all existing members' npubs
5. Server marks channel as encrypted (channels.encrypted = 1)
6. Background batch job encrypts existing plaintext messages
```

### Batch Message Encryption

When upgrading a channel, existing messages are encrypted in the background:

```javascript
// Client-side batch encryption
async function upgradeChannelMessages(channelId, channelKey) {
  const messages = await fetchPlaintextMessages(channelId);

  for (const batch of chunk(messages, 50)) {
    const encrypted = await Promise.all(
      batch.map(msg => ({
        id: msg.id,
        content: encrypt(msg.content, channelKey),
        encrypted: 1,
        key_version: 1
      }))
    );
    await submitEncryptedBatch(channelId, encrypted);
  }
}
```

- Process in batches of 50 messages to avoid UI blocking
- Show progress indicator to owner during upgrade
- New messages sent during upgrade are encrypted immediately
- Server endpoint accepts batch updates from channel owner only

### Channels Table Addition

```sql
ALTER TABLE channels ADD COLUMN encrypted INTEGER DEFAULT 0;
ALTER TABLE channels ADD COLUMN encryption_enabled_at TEXT DEFAULT NULL;
```

## UI Indicators

### Channel List
- Existing lock icon (🔒) for private channels - no change needed
- Lock icon indicates access control, not necessarily encryption

### Message Display
- Faint grey encrypted symbol next to message menu for encrypted messages
- Only shown on messages where `encrypted=1`
- Subtle indicator - doesn't distract from content
- Helps users understand which messages are E2E protected

```css
.message-encrypted-indicator {
  color: #9ca3af;  /* grey-400 */
  font-size: 0.75rem;
  opacity: 0.6;
  margin-right: 4px;
}
```

### Channel Header (optional enhancement)
- Could show "End-to-end encrypted" badge in channel header for encrypted channels

## Notifications

- **Allowed**: Channel name, sender name, "new message" indicator
- **Not allowed**: Message content preview
- User clicks notification to open app and decrypt locally

## DMs

DMs are treated as 2-person private channels using the same model:
- DM channel gets a symmetric key
- Key wrapped to both participants
- Same encryption/decryption flow

Alternative considered: Direct NIP-44 (pubkey-to-pubkey) without shared key. Decided against for consistency - same model for all encrypted channels.

---

## Future Considerations (Out of Scope)

### Key Rotation

When removing a member, ideally the channel key should rotate so the removed member can't decrypt new messages. Approach:

1. Owner generates new channel key
2. Owner re-encrypts to all remaining members
3. New messages use new key_version
4. Old messages remain readable with old key (members retain historical key versions)

**Complexity**: O(n) re-encryption operations per rotation. Deferred for simplicity.

**Current approach**: Server enforces access control. Removed members can't fetch new messages even if they have the key. Encryption is primarily to protect against server/DB compromise, not removed members.

### Client-Side Search & Indexing

With E2E encryption, server cannot search message content. Future options:

1. **Client-side full-text index** - IndexedDB with decrypted content
2. **Local-first sync** - Cache all messages locally, search offline
3. **Searchable encryption** - Complex, likely overkill

This aligns with future goals for offline/local-first capabilities.

### Multi-Device Key Sync

If a user has multiple devices, they need their channel keys on each. Options:

1. **Re-invite from another device** - Owner sends key again
2. **Key backup** - User exports/imports encrypted key bundle
3. **Nostr-based sync** - Store encrypted key bundle as Nostr event

### Ephemeral User Key Recovery

Users with ephemeral login (localStorage keys) risk losing access if storage is cleared. Options:

1. **Encourage extension login** - Keys stored in nos2x/Alby
2. **Key backup prompt** - Export encrypted key bundle
3. **Social recovery** - N-of-M key shards with trusted contacts

---

## Implementation Work Packages

### WP1: Database Schema

**Objective**: Add tables and columns to support encryption

- [ ] 1.1: Create `user_channel_keys` table
- [ ] 1.2: Add `encrypted`, `key_version` columns to `messages` table
- [ ] 1.3: Add `encrypted`, `encryption_enabled_at` columns to `channels` table
- [ ] 1.4: Add migration script for existing databases

**Files**: `src/db.ts`

---

### WP2: Crypto Utilities (Client)

**Objective**: Create client-side encryption/decryption utilities

- [ ] 2.1: Create `public/crypto.js` module
- [ ] 2.2: Implement `generateChannelKey()` - AES-256-GCM key generation via Web Crypto
- [ ] 2.3: Implement `encryptMessage(plaintext, key)` - AES-256-GCM encryption
- [ ] 2.4: Implement `decryptMessage(ciphertext, key)` - AES-256-GCM decryption
- [ ] 2.5: Implement `wrapKeyForUser(channelKey, recipientPubkey)` - NIP-44 key wrapping
- [ ] 2.6: Implement `unwrapKey(wrappedKey, senderPubkey)` - NIP-44 key unwrapping
- [ ] 2.7: Implement `createSignedPayload(content, senderPubkey)` - wrap content with Nostr signature
- [ ] 2.8: Implement `verifySignedPayload(payload)` - verify signature matches sender
- [ ] 2.9: Add unit tests for crypto operations

**Signed Payload Functions**:
```javascript
// Create payload with Nostr signature (uses NIP-07 extension or ephemeral key)
async function createSignedPayload(content) {
  const ts = Math.floor(Date.now() / 1000);
  const message = `${content}:${ts}`;
  const sig = await window.nostr.signSchnorr(message); // or use ephemeral key
  const sender = await window.nostr.getPublicKey();

  return JSON.stringify({ content, sender, ts, sig });
}

// Verify payload signature
function verifySignedPayload(payload) {
  const { content, sender, ts, sig } = JSON.parse(payload);
  const message = `${content}:${ts}`;
  const valid = schnorr.verify(sig, message, sender); // nostr-tools
  return { valid, content, sender, ts };
}
```

**Files**: `public/crypto.js`, `tests/crypto.test.ts`

**Dependencies**: `nostr-tools` for NIP-44 and Schnorr signatures

---

### WP3: Key Management API

**Objective**: Server endpoints for storing/retrieving encrypted keys

- [ ] 3.1: `POST /api/channels/:id/keys` - Store wrapped key for a user
- [ ] 3.2: `GET /api/channels/:id/keys` - Get current user's wrapped key
- [ ] 3.3: `POST /api/channels/:id/keys/batch` - Store keys for multiple users (channel creation/upgrade)
- [ ] 3.4: Add authorization checks (owner-only for storing other users' keys)

**Files**: `src/routes/channels.ts`, `src/db.ts`

---

### WP4: Encrypted Channel Creation

**Objective**: Generate and distribute keys when creating a private channel

- [ ] 4.1: Update channel creation UI to support "encrypted" option for private channels
- [ ] 4.2: On creation, client generates channel key
- [ ] 4.3: Client wraps key to owner's pubkey
- [ ] 4.4: Client sends wrapped key to server via `/api/channels/:id/keys`
- [ ] 4.5: Server sets `channels.encrypted = 1`

**Files**: `public/channels.js`, `src/routes/channels.ts`, `src/render/channels.ts`

---

### WP5: Member Invitation with Key Distribution

**Objective**: Share channel key when inviting members (including offline users)

- [ ] 5.1: When owner invites a member, fetch owner's wrapped key
- [ ] 5.2: Unwrap to get channel key
- [ ] 5.3: Wrap channel key to new member's pubkey (works even if user never logged in)
- [ ] 5.4: Store new member's wrapped key via API
- [ ] 5.5: Handle invitation UI flow
- [ ] 5.6: On login, client checks for pre-distributed keys in channels user is member of

**Note**: Key pre-distribution works because NIP-44 only needs recipient's pubkey (not nsec). User decrypts on first login.

**Files**: `public/channels.js`, `public/crypto.js`, `public/app.js` (login flow)

**Prerequisite**: WP2, WP3, WP4

---

### WP6: Message Encryption/Decryption

**Objective**: Encrypt outgoing messages, decrypt incoming messages

- [ ] 6.1: Create key cache in client using `sessionStorage` (decrypt key once per session, clears on tab close)
- [ ] 6.2: On send: wrap content in signed payload `{content, sender, ts, sig}`, then encrypt
- [ ] 6.3: Server stores encrypted content with `encrypted=1`, `key_version`
- [ ] 6.4: On receive: decrypt, verify sender signature, reject if invalid
- [ ] 6.5: Handle SSE events for encrypted messages
- [ ] 6.6: Update message rendering to handle encrypted, plaintext, and error states
- [ ] 6.7: Show `[Unable to decrypt message]` placeholder on decryption failure
- [ ] 6.8: Show `[Unverified message]` placeholder if signature verification fails

**Key Cache Strategy**:
```javascript
// sessionStorage - survives page refresh, clears on tab close
const CACHE_KEY = 'mg_channel_keys';

function getCachedKey(channelId) {
  const cache = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
  return cache[channelId]; // Returns raw symmetric key or undefined
}

function setCachedKey(channelId, key) {
  const cache = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
  cache[channelId] = key;
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}
```

**Files**: `public/chat.js`, `public/crypto.js`, `src/routes/chat.ts`

**Prerequisite**: WP2, WP3

---

### WP7: Channel Upgrade Flow

**Objective**: Convert existing channel to encrypted, batch-encrypt old messages

- [ ] 7.1: Add "Enable encryption" option in channel settings (owner only)
- [ ] 7.2: Generate channel key, distribute to all current members
- [ ] 7.3: Create `GET /api/channels/:id/messages/plaintext` - fetch unencrypted messages for batch processing
- [ ] 7.4: Create `POST /api/channels/:id/messages/encrypt-batch` - accept batch of encrypted messages
- [ ] 7.5: Client-side batch encryption with progress indicator
- [ ] 7.6: Mark channel as encrypted after batch completes
- [ ] 7.7: Handle edge case: new messages during upgrade

**Files**: `public/channels.js`, `public/crypto.js`, `src/routes/channels.ts`, `src/routes/chat.ts`

**Prerequisite**: WP2, WP3, WP4, WP5, WP6

---

### WP8: UI Indicators

**Objective**: Visual feedback for encrypted content

- [ ] 8.1: Add encrypted indicator icon/symbol next to message menu
- [ ] 8.2: Style with faint grey, subtle appearance
- [ ] 8.3: Only show for messages with `encrypted=1`
- [ ] 8.4: (Optional) Add "End-to-end encrypted" badge in channel header

**Files**: `public/app.css`, `public/chat.js`, `src/render/chat.ts`

**Prerequisite**: WP6

---

### WP9: Testing & Validation

**Objective**: Ensure encryption works correctly end-to-end

- [ ] 9.1: Unit tests for crypto utilities
- [ ] 9.2: Integration tests for key distribution flow
- [ ] 9.3: Test backwards compatibility (mixed encrypted/plaintext messages)
- [ ] 9.4: Test channel upgrade with existing messages
- [ ] 9.5: Test multi-user scenarios (owner + members)
- [ ] 9.6: Verify server cannot read encrypted content (inspect DB)

**Files**: `tests/encryption.test.ts`

**Prerequisite**: WP1-WP8

---

## Work Package Dependency Graph

```
WP1 (Schema)
 │
 ├── WP2 (Crypto Utils)
 │    │
 │    └── WP3 (Key API)
 │         │
 │         ├── WP4 (Channel Creation)
 │         │    │
 │         │    └── WP5 (Invitation)
 │         │
 │         └── WP6 (Message Encrypt/Decrypt)
 │              │
 │              ├── WP7 (Channel Upgrade)
 │              │
 │              └── WP8 (UI Indicators)
 │
 └────────────────────────────────────── WP9 (Testing)
```

**Recommended execution order**: WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → WP8 → WP7 → WP9
