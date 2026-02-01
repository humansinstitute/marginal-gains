# Key Teleport v2 Sender Requirements

This document formalises the requirements for sending a Key Teleport to Marginal Gains from an external key manager application.

## Overview

Key Teleport v2 allows users to securely transfer their Nostr identity from a key manager to Marginal Gains via a URL. The key is protected with double NIP-44 encryption:
- **Outer layer**: Encrypted to the receiving app's pubkey
- **Inner layer**: Encrypted with a throwaway keypair (the "unlock code")

**Key differences from v1:**
- Self-contained blobs (no API callback to key manager)
- Fragment URLs (`#keyteleport=`) - server never sees the blob
- Throwaway keypair instead of PIN for inner encryption

## Flow Summary

```
┌─────────────────────┐                    ┌─────────────────────┐
│   Key Manager App   │                    │   Marginal Gains    │
│     (Welcome)       │                    │                     │
└──────────┬──────────┘                    └──────────┬──────────┘
           │                                          │
           │ 1. Generate throwaway keypair            │
           │ 2. Encrypt nsec (user→throwaway)         │
           │ 3. Create payload {encryptedNsec,npub,v} │
           │ 4. Encrypt payload (welcome→MG pubkey)   │
           │ 5. Sign event, encode as blob            │
           │ 6. Copy throwaway nsec to clipboard      │
           │                                          │
           │ ──── User clicks fragment URL ─────────> │
           │      #keyteleport=<blob>&ic=<invite>     │
           │                                          │
           │                    7. Client reads blob  │
           │                    8. POST to server     │
           │                    9. Decrypt outer layer│
           │                   10. Return encrypted   │
           │                       nsec to client     │
           │                   11. Prompt for unlock  │
           │                   12. Decrypt inner layer│
           │                   13. Login complete     │
           └──────────────────────────────────────────┘
```

## Prerequisites

### Key Manager Requirements

1. Access to the user's Nostr private key (nsec)
2. A signing key for the Key Manager
3. Knowledge of Marginal Gains' public key (obtained via app registration)

### Marginal Gains Configuration

| Variable | Description |
|----------|-------------|
| `KEYTELEPORT_PRIVKEY` | Private key (nsec or 64-char hex) for decrypting teleport payloads |

Note: `KEYTELEPORT_WELCOME_PUBKEY` is **no longer needed** in v2 - decryption success validates the recipient.

## App Registration

Before users can teleport keys, the app must be registered in Welcome:

1. User visits Marginal Gains login page
2. Clicks "Setup Key Teleport" button
3. Copies the registration blob
4. Pastes it into Welcome at `/teleport/setup`

The registration blob is a signed Nostr event:

```typescript
{
  kind: 30078,
  pubkey: "<app's hex pubkey>",
  created_at: <timestamp>,
  tags: [["type", "keyteleport-app-registration"]],
  content: JSON.stringify({
    url: "https://mg.otherstuff.ai",
    name: "Marginal Gains",
    description: "Track your tasks and collaborate with your team"
  }),
  sig: "<signature>"
}
```

## Teleport Blob Structure

The teleport blob is a base64-encoded signed Nostr event:

```typescript
// Outer event (signed by Welcome)
{
  kind: 21059,
  pubkey: "<welcome's hex pubkey>",
  created_at: <timestamp>,
  tags: [],  // No recipient tag (quantum resistance)
  content: "<NIP-44 encrypted payload>",
  sig: "<signature>"
}

// Decrypted payload (v2 protocol)
{
  encryptedNsec: "<NIP-44 encrypted nsec>",  // Inner layer
  npub: "npub1...",                           // User's public key
  v: 1                                        // Protocol version
}
```

### Inner Layer Encryption

The `encryptedNsec` is NIP-44 encrypted using:
- **Private key**: The throwaway secret key
- **Public key**: The user's public key (derived from npub)

This ensures only someone with the throwaway key (copied to clipboard) can decrypt the final nsec.

## URL Format

```
https://mg.otherstuff.ai/#keyteleport=<blob>&ic=<invite_code>
```

- `keyteleport`: Base64-encoded signed event (URL-encoded)
- `ic`: Optional invite code for auto-joining a team

**Important**: Using fragment (`#`) instead of query params (`?`) ensures the blob never reaches server logs.

## Implementation Example

```javascript
import { nip19, nip44, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

function createKeyTeleport(userSecretKey, userNpub, welcomeSecretKey, appPubkey, inviteCode = null) {
  // 1. Generate throwaway keypair
  const throwawaySecretKey = generateSecretKey();
  const throwawayNsec = nip19.nsecEncode(throwawaySecretKey);

  // 2. Encode user's key as nsec
  const userNsec = nip19.nsecEncode(userSecretKey);

  // 3. Encrypt nsec with throwaway key → user pubkey
  const { data: userPubkey } = nip19.decode(userNpub);
  const innerConvKey = nip44.v2.utils.getConversationKey(throwawaySecretKey, userPubkey);
  const encryptedNsec = nip44.v2.encrypt(userNsec, innerConvKey);

  // 4. Create v2 payload
  const payload = {
    encryptedNsec,
    npub: userNpub,
    v: 1
  };

  // 5. Encrypt payload to app's pubkey
  const outerConvKey = nip44.v2.utils.getConversationKey(welcomeSecretKey, appPubkey);
  const encryptedPayload = nip44.v2.encrypt(JSON.stringify(payload), outerConvKey);

  // 6. Sign event
  const event = finalizeEvent({
    kind: 21059,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: encryptedPayload
  }, welcomeSecretKey);

  // 7. Create URL
  const blob = btoa(JSON.stringify(event));
  const params = new URLSearchParams();
  params.set('keyteleport', blob);
  if (inviteCode) params.set('ic', inviteCode);

  const url = `https://mg.otherstuff.ai/#${params.toString()}`;

  return {
    url,
    unlockCode: throwawayNsec  // Copy this to clipboard
  };
}
```

## Security Model

| Component | Protection |
|-----------|------------|
| User's nsec | Double encrypted (throwaway + app key) |
| Teleport blob | Fragment URL (never in server logs) |
| Target app identity | Not in blob (quantum resistance) |
| Unlock code | Only on user's clipboard |

### To decrypt user's nsec, attacker needs BOTH:
1. Target app's private key (to decrypt outer layer)
2. Throwaway private key (only on user's clipboard)

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "Key Teleport not configured" | Missing KEYTELEPORT_PRIVKEY | Set environment variable |
| "Decryption failed - wrong recipient?" | Blob not for this app | Check app registration |
| "Unsupported protocol version" | Wrong v value | Use v: 1 |
| "Invalid unlock code" | Wrong throwaway nsec | User should paste correct code |

## Invite Code Integration

The `ic` parameter enables auto-joining a team after login:

1. Key manager includes invite code in URL fragment
2. After successful login, client redeems invite code
3. User is redirected to team chat

Example URL with invite:
```
https://mg.otherstuff.ai/#keyteleport=<blob>&ic=abc123
```
