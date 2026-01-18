# Key Teleport Sender Requirements

This document formalises the requirements for sending a Key Teleport to Marginal Gains from an external key manager application.

## Overview

Key Teleport allows users to securely transfer their Nostr identity from a key manager to Marginal Gains via a URL. The key is protected with NIP-49 encryption using a 6-digit PIN that the user sets before teleport.

## Flow Summary

```
┌─────────────────────┐                    ┌─────────────────────┐
│   Key Manager App   │                    │   Marginal Gains    │
└──────────┬──────────┘                    └──────────┬──────────┘
           │                                          │
           │ 1. User enters 6-digit PIN               │
           │ 2. Encrypt nsec → ncryptsec (NIP-49)     │
           │ 3. Store ncryptsec with hash_id          │
           │ 4. Create signed payload                 │
           │ 5. NIP-44 encrypt to MG pubkey           │
           │ 6. Generate teleport URL                 │
           │                                          │
           │ ──────── User clicks URL ──────────────> │
           │                                          │
           │ <─────── GET /api/keys?id={hash} ─────── │
           │                                          │
           │ ──────── { ncryptsec } ─────────────────>│
           │                                          │
           │                    7. Prompt user for PIN│
           │                    8. Decrypt ncryptsec  │
           │                    9. Login complete     │
           └──────────────────────────────────────────┘
```

## Prerequisites

### Key Manager Requirements

1. Access to the user's Nostr private key (nsec)
2. A signing key for the Key Manager (the "welcome key")
3. Knowledge of Marginal Gains' public key

### Marginal Gains Configuration

Marginal Gains must have the following environment variables set:

| Variable | Description |
|----------|-------------|
| `KEYTELEPORT_PRIVKEY` | Private key (nsec or 64-char hex) for decrypting teleport payloads |
| `KEYTELEPORT_WELCOME_PUBKEY` | Public key (npub or 64-char hex) of the trusted Key Manager |

The Key Manager must sign payloads with the private key corresponding to `KEYTELEPORT_WELCOME_PUBKEY`.

## Step-by-Step Implementation

### Step 1: Encrypt the User's Key with NIP-49

When the user initiates a teleport, prompt them for a 6-digit PIN and encrypt their nsec:

```javascript
import { nip49 } from 'nostr-tools';

// User's private key (Uint8Array, 32 bytes)
const secretKey = /* user's secret key bytes */;

// 6-digit PIN from user input
const pin = "123456";

// Encrypt to ncryptsec format
// logN controls scrypt difficulty (16 is standard, higher = slower but more secure)
const ncryptsec = nip49.encrypt(secretKey, pin, 16);
// Result: "ncryptsec1qgg9947..."
```

### Step 2: Store the ncryptsec

Generate a unique identifier and store the ncryptsec for later retrieval:

```javascript
// Generate unique hash_id (e.g., UUID or random hex)
const hash_id = crypto.randomUUID();

// Calculate expiry timestamp (Unix seconds)
// This is when the key will be deleted from the Key Manager
const expiryTimestamp = Math.floor(Date.now() / 1000) + (5 * 60); // 5 minutes

// Store in your database/memory
store.set(hash_id, {
  ncryptsec,
  expiresAt: expiryTimestamp
});
```

### Step 3: Create the Payload

The payload contains the information Marginal Gains needs to fetch the key:

```typescript
interface KeyTeleportPayload {
  apiRoute: string;    // Full URL to your key retrieval endpoint
  hash_id: string;     // Unique identifier for this teleport
  timestamp: number;   // Unix timestamp (seconds) when key expires
}
```

Example:

```javascript
const payload = {
  apiRoute: "http://localhost:8080/api/keys",
  hash_id: hash_id,
  timestamp: expiryTimestamp
};
```

### Step 4: Create and Sign a Nostr Event

Wrap the payload in a signed Nostr event:

```javascript
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';

// Key Manager's signing key (the "welcome key")
const welcomeSecretKey = /* your signing key bytes */;
const welcomePubkey = getPublicKey(welcomeSecretKey);

// Marginal Gains' public key (hex format)
const marginalGainsPubkey = "abc123..."; // 64-char hex

// Create conversation key for NIP-44 encryption
const conversationKey = nip44.v2.utils.getConversationKey(
  bytesToHex(welcomeSecretKey),
  marginalGainsPubkey
);

// Encrypt the payload
const encryptedContent = nip44.v2.encrypt(
  JSON.stringify(payload),
  conversationKey
);

// Create the Nostr event
const event = {
  kind: 21059,  // Arbitrary kind for key teleport (or use another appropriate kind)
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: encryptedContent,
  pubkey: welcomePubkey
};

// Sign the event
const signedEvent = finalizeEvent(event, welcomeSecretKey);
```

### Step 5: Generate the Teleport URL

Encode the signed event and create the URL:

```javascript
// Serialize the signed event to JSON
const eventJson = JSON.stringify(signedEvent);

// Base64 encode for URL transport
const blob = btoa(eventJson);

// Construct the teleport URL
const marginalGainsUrl = "https://your-marginalgains-instance.com";
const teleportUrl = `${marginalGainsUrl}/?keyteleport=${encodeURIComponent(blob)}`;
```

### Step 6: Implement the Key Retrieval Endpoint

Your Key Manager must expose an HTTP endpoint that Marginal Gains will call:

**Endpoint:** `GET {apiRoute}?id={hash_id}`

**Request:**
```
GET /api/keys?id=550e8400-e29b-41d4-a716-446655440000
```

**Response (Success):**
```json
{
  "ncryptsec": "ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p"
}
```

**Response (Not Found / Expired):**
```json
{
  "error": "Key not found or expired"
}
```

**HTTP Status Codes:**
- `200` - Success, ncryptsec returned
- `404` - Key not found or expired
- `400` - Invalid request

### Step 7: Clean Up

Delete the ncryptsec from storage after:
- It has been successfully retrieved, OR
- The timestamp has passed (expiry)

This ensures one-time use and limits exposure window.

## Complete Example

```javascript
import { nip44, nip49 } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createKeyTeleport(userSecretKey, pin, welcomeSecretKey, marginalGainsPubkey, apiBaseUrl) {
  // Step 1: Encrypt user's key with NIP-49
  const ncryptsec = nip49.encrypt(userSecretKey, pin, 16);

  // Step 2: Generate hash_id and expiry
  const hash_id = crypto.randomUUID();
  const expiryTimestamp = Math.floor(Date.now() / 1000) + (5 * 60);

  // Store ncryptsec (implement your storage)
  await storeKey(hash_id, ncryptsec, expiryTimestamp);

  // Step 3: Create payload
  const payload = {
    apiRoute: `${apiBaseUrl}/api/keys`,
    hash_id: hash_id,
    timestamp: expiryTimestamp
  };

  // Step 4: Create signed event with NIP-44 encrypted content
  const welcomePubkey = getPublicKey(welcomeSecretKey);
  const conversationKey = nip44.v2.utils.getConversationKey(
    bytesToHex(welcomeSecretKey),
    marginalGainsPubkey
  );

  const encryptedContent = nip44.v2.encrypt(
    JSON.stringify(payload),
    conversationKey
  );

  const signedEvent = finalizeEvent({
    kind: 21059,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: encryptedContent,
    pubkey: welcomePubkey
  }, welcomeSecretKey);

  // Step 5: Generate URL
  const blob = btoa(JSON.stringify(signedEvent));
  const teleportUrl = `https://marginalgains.example.com/?keyteleport=${encodeURIComponent(blob)}`;

  return teleportUrl;
}
```

## Security Considerations

1. **PIN Strength**: 6-digit PINs provide limited entropy (10^6 = 1 million combinations). NIP-49 uses scrypt to slow brute-force attacks, but users should be advised that this is for convenience, not high-security scenarios.

2. **Short-Lived Keys**: Set short expiry timestamps (5-15 minutes) to limit the window where the ncryptsec is retrievable.

3. **One-Time Use**: Delete the ncryptsec after successful retrieval to prevent replay.

4. **HTTPS Required**: The Key Manager endpoint should use HTTPS in production.

5. **Trusted Key Manager**: Marginal Gains only accepts payloads signed by the configured `KEYTELEPORT_WELCOME_PUBKEY`. Protect this signing key.

6. **Signature Verification**: Marginal Gains verifies the event signature before processing, preventing tampering.

7. **NIP-44 Encryption**: The payload is encrypted to Marginal Gains' public key, ensuring only the intended recipient can read it.

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| "Key Teleport not configured" | Missing env vars on MG | Set `KEYTELEPORT_PRIVKEY` and `KEYTELEPORT_WELCOME_PUBKEY` |
| "Untrusted source" | Signature from wrong key | Ensure you're signing with the key matching `KEYTELEPORT_WELCOME_PUBKEY` |
| "Key teleport link has expired" | Timestamp in past | Check timestamp is in the future |
| "Failed to reach key manager" | Network/CORS issue | Ensure endpoint is accessible from MG server |
| "Wrong PIN" | User entered wrong PIN | Re-enter correct 6-digit PIN |

## Data Structures Reference

### Signed Event (before base64 encoding)

```typescript
interface KeyTeleportEvent {
  id: string;           // Event ID (32-byte hex)
  pubkey: string;       // Welcome key pubkey (32-byte hex)
  created_at: number;   // Unix timestamp
  kind: number;         // Event kind (e.g., 21059)
  tags: string[][];     // Empty or custom tags
  content: string;      // NIP-44 encrypted payload
  sig: string;          // Schnorr signature (64-byte hex)
}
```

### Decrypted Payload

```typescript
interface KeyTeleportPayload {
  apiRoute: string;    // e.g., "http://localhost:8080/api/keys"
  hash_id: string;     // e.g., "550e8400-e29b-41d4-a716-446655440000"
  timestamp: number;   // e.g., 1705600000
}
```

### Key Manager Response

```typescript
interface KeyManagerResponse {
  ncryptsec: string;   // NIP-49 encrypted key, e.g., "ncryptsec1..."
}
```
