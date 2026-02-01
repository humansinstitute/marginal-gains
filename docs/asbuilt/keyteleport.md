# Key Teleport v2 - As Built

## Overview

Key Teleport enables secure transfer of Nostr identities between Welcome (key manager) and Marginal Gains (receiver). This document describes the v2 implementation as built in Marginal Gains.

**Two Flows:**
1. **App Registration** - User connects Marginal Gains to Welcome (one-time setup)
2. **Key Teleport** - User teleports their key from Welcome to Marginal Gains (login)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              APP REGISTRATION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Marginal Gains                                    Welcome                  │
│  ──────────────                                    ───────                  │
│                                                                             │
│  1. User expands "Advanced Options"                                         │
│     └── Clicks "Setup Key Teleport"                                        │
│                                                                             │
│  2. Modal opens, fetches registration blob                                  │
│     └── GET /api/keyteleport/register                                      │
│                                                                             │
│  3. Server generates signed event:                                          │
│     └── kind: 30078                                                        │
│     └── content: { url, name, description }                                │
│     └── tags: [["type", "keyteleport-app-registration"]]                   │
│     └── signed by: Marginal Gains' KEYTELEPORT_PRIVKEY                     │
│                                                                             │
│  4. User copies blob to clipboard                                           │
│                                                                             │
│  5. User pastes blob into Welcome ──────────────────────►                   │
│                                                                             │
│                                         6. Welcome verifies signature       │
│                                         7. Welcome stores app registration  │
│                                            - app_pubkey (Marginal Gains)   │
│                                            - url, name, description        │
│                                                                             │
│  ✓ Marginal Gains is now registered!                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              KEY TELEPORT                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Welcome                                         Marginal Gains             │
│  ───────                                         ──────────────             │
│                                                                             │
│  1. User clicks "Teleport to Marginal Gains"                                │
│                                                                             │
│  2. Generate throwaway keypair                                              │
│     └── throwawaySecretKey, throwawayPubkey                                │
│                                                                             │
│  3. Encrypt user's nsec (inner layer)                                       │
│     └── NIP-44(nsec, throwawayKey + userPubkey)                            │
│                                                                             │
│  4. Create payload:                                                         │
│     └── { encryptedNsec, npub, v: 1 }                                      │
│                                                                             │
│  5. Encrypt payload to Marginal Gains (outer layer)                         │
│     └── NIP-44(payload, welcomeKey + mgPubkey)                             │
│                                                                             │
│  6. Sign event with Welcome's key                                           │
│     └── kind: 21059                                                        │
│     └── tags: [] (empty - no recipient tag)                                │
│                                                                             │
│  7. Base64 encode → blob                                                    │
│                                                                             │
│  8. Copy throwaway nsec to clipboard (unlock code)                          │
│                                                                             │
│  9. Open: https://mg.example.com/#keyteleport={blob}&ic={invite}           │
│                                                 │                           │
│                                                 ▼                           │
│                                  10. Client reads fragment                  │
│                                      └── window.location.hash              │
│                                      └── Server never sees blob            │
│                                                                             │
│                                  11. Clear fragment immediately             │
│                                      └── history.replaceState              │
│                                                                             │
│                                  12. POST /api/keyteleport {blob}           │
│                                      └── Verify signature                  │
│                                      └── Decrypt outer layer               │
│                                      └── Return {encryptedNsec, npub}      │
│                                                                             │
│                                  13. Show unlock code modal                 │
│                                      └── User pastes from clipboard        │
│                                                                             │
│                                  14. Decrypt inner layer                    │
│                                      └── NIP-44 with throwaway key         │
│                                      └── Get user's nsec                   │
│                                                                             │
│                                  15. Store in sessionStorage                │
│                                      └── EPHEMERAL_SECRET_KEY              │
│                                                                             │
│                                  16. Sign login event as "secret"           │
│                                                                             │
│                                  17. Auto-redeem invite code (if present)   │
│                                                                             │
│                                  ✓ User authenticated!                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Structure

| File | Purpose |
|------|---------|
| `src/config.ts` | `getKeyTeleportIdentity()` - loads KEYTELEPORT_PRIVKEY |
| `src/routes/keyteleport.ts` | Server endpoints for both flows |
| `src/server.ts` | Route wiring |
| `src/render/landing.ts` | Login UI with setup button and modals |
| `src/render/chat.ts` | Chat page login UI (fallback) |
| `src/render/home.ts` | Tasks page login UI (fallback) |
| `src/render/components.ts` | `renderKeyTeleportSetupModal()`, `renderUnlockCodeModal()` |
| `public/auth.js` | Client-side logic for both flows |
| `public/unlockModal.js` | Unlock code modal handlers |
| `public/app.css` | Modal and button styling |

## Environment Variables

```bash
# Marginal Gains' keypair for key teleport
# Used for: signing registration blobs, decrypting teleport payloads
KEYTELEPORT_PRIVKEY=nsec1...  # or 64-char hex
```

Note: `KEYTELEPORT_WELCOME_PUBKEY` is **not needed** in v2 - decryption success validates the recipient.

## API Endpoints

### GET /api/keyteleport/register

Generates a registration blob for connecting Marginal Gains to a key manager.

**Response:**
```json
{
  "blob": "<base64-encoded signed Nostr event>",
  "npub": "npub1...",
  "pubkey": "<hex>"
}
```

**Event Structure:**
```typescript
{
  kind: 30078,
  pubkey: "<mg_pubkey_hex>",
  created_at: <unix_timestamp>,
  tags: [["type", "keyteleport-app-registration"]],
  content: JSON.stringify({
    url: "https://dev93.otherstuff.studio",  // Dynamic based on deployment
    name: "Marginal Gains",
    description: "Track your tasks and collaborate with your team"
  }),
  sig: "<signature>"
}
```

The URL is determined dynamically from request headers (`X-Forwarded-Host`, `Host`) to support different deployment environments.

### POST /api/keyteleport

Decrypts a teleport blob and returns the encrypted nsec for client-side decryption.

**Request:**
```json
{
  "blob": "<base64-encoded signed Nostr event>"
}
```

**Response:**
```json
{
  "encryptedNsec": "<NIP-44 encrypted nsec>",
  "npub": "npub1..."
}
```

**Error Codes:**
| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid blob, decryption failed, or unsupported version |
| 503 | KEYTELEPORT_PRIVKEY not configured |

## Client-Side Implementation

### auth.js - Fragment Detection

```javascript
const checkKeyTeleport = async () => {
  const hash = window.location.hash;
  if (!hash.includes("keyteleport=")) return false;

  // Parse fragment as URL params (remove leading #)
  const params = new URLSearchParams(hash.slice(1));
  const blob = params.get("keyteleport");
  if (!blob) return false;

  // Capture invite code before clearing fragment
  const inviteCode = params.get("ic");

  // Clear the fragment immediately - server never sees this
  history.replaceState(null, "", window.location.pathname + window.location.search);

  // ... process blob
};
```

### auth.js - Inner Layer Decryption

```javascript
// User's npub decoded to hex pubkey
const { data: userPubkey } = nip19.decode(npub);

// Throwaway secret from unlock code
const { data: throwawaySecretKey } = nip19.decode(unlockCode);

// Derive conversation key and decrypt
const conversationKey = nip44.v2.utils.getConversationKey(
  bytesToHex(throwawaySecretKey),
  userPubkey
);

const decryptedNsec = nip44.v2.decrypt(encryptedNsec, conversationKey);
```

### auth.js - Setup Modal Wiring

```javascript
const wireKeyTeleportSetup = () => {
  const setupBtn = document.querySelector("[data-keyteleport-setup]");

  setupBtn.addEventListener("click", async () => {
    const response = await fetch("/api/keyteleport/register");
    const { blob } = await response.json();
    // Display blob in modal for user to copy
  });
};
```

## UI Components

### Login Screen Button

Located in Advanced Options section:

```html
<details class="auth-advanced">
  <summary>Advanced Options (nsec, bunker://...)</summary>
  <!-- ... other options ... -->
  <div class="keyteleport-setup-section">
    <p class="keyteleport-setup-label">Have a Welcome key manager?</p>
    <button class="keyteleport-setup-btn" type="button" data-keyteleport-setup>
      Setup Key Teleport
    </button>
  </div>
</details>
```

### Setup Modal

```html
<div class="keyteleport-setup-overlay" data-keyteleport-setup-modal hidden>
  <div class="keyteleport-setup-modal">
    <h2>Setup Key Teleport</h2>
    <p>Copy this registration code and paste it into your Welcome key manager...</p>
    <textarea data-keyteleport-setup-blob readonly rows="4"></textarea>
    <div class="keyteleport-setup-actions">
      <button data-keyteleport-setup-cancel>Close</button>
      <button data-keyteleport-setup-copy>Copy Code</button>
    </div>
  </div>
</div>
```

### Unlock Code Modal

```html
<div class="unlock-modal-overlay" data-unlock-modal hidden>
  <div class="unlock-modal">
    <h2 data-unlock-title>Paste Unlock Code</h2>
    <p data-unlock-subtitle>Paste the unlock code from your clipboard</p>
    <input type="password" data-unlock-input placeholder="nsec1..." />
    <p class="unlock-error" data-unlock-error hidden></p>
    <div class="unlock-actions">
      <button data-unlock-cancel>Cancel</button>
      <button data-unlock-submit>Unlock</button>
    </div>
  </div>
</div>
```

### Teleport In-Progress Overlay

```html
<div class="keyteleport-overlay" data-keyteleport-overlay hidden>
  <div class="keyteleport-spinner"></div>
  <p>Key Teleport in Progress</p>
</div>
```

## Security Model

### Double Encryption

```
Teleport Blob Structure:
└── Signed Nostr event (Welcome's key)
    ├── pubkey: Welcome's pubkey (for signature verification)
    ├── tags: []  (empty - no recipient pubkey for quantum resistance)
    ├── content: NIP-44 encrypted (Welcome → Marginal Gains):
    │   └── payload:
    │       ├── encryptedNsec (NIP-44: throwaway → user)
    │       ├── npub
    │       └── v: 1
    └── sig: signature
```

### Why No Recipient Tag?

The blob intentionally omits `["p", mgPubkey]`:

1. **Quantum resistance** - Exposed public keys could theoretically be reversed
2. **Validation via decryption** - NIP-44 auth failure = wrong recipient
3. **Privacy** - Intercepted blobs don't reveal target app

### Fragment URLs

Using `#keyteleport=` instead of `?keyteleport=`:

- Fragment is **never sent to server** (not in HTTP request)
- Server logs only show `https://mg.example.com/`
- Only client-side JavaScript can read `window.location.hash`

### Key Storage

After successful teleport:
- Key stored in `sessionStorage` as `EPHEMERAL_SECRET_KEY`
- Cleared when browser tab closes
- User can set up PIN encryption for persistent storage

## Invite Code Integration

The `ic` parameter enables auto-joining a team after teleport:

```
https://mg.example.com/#keyteleport=<blob>&ic=<invite_code>
```

Flow:
1. After successful login, client checks for `inviteCode`
2. POSTs to `/api/team-invites/redeem` with the code
3. On success, redirects to `/t/{team}/chat`
4. On already-member, redirects to team chat
5. On failure, redirects to home

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Already logged in | Skip teleport, clear fragment |
| Existing key in storage | Skip teleport, auto-login with existing key |
| KEYTELEPORT_PRIVKEY not set | Return 503, setup button shows error |
| Decryption fails (wrong app) | Return 400 "Decryption failed - wrong recipient?" |
| Invalid unlock code | Show error in modal, let user retry |
| User cancels unlock | Return to login screen |
| Invalid protocol version | Return 400 "Unsupported protocol version" |
| Missing payload fields | Return 400 "Missing required fields" |

## Dependencies

**Server (Bun):**
- `nostr-tools` - finalizeEvent, verifyEvent, nip44

**Client (ESM CDN):**
- `nostr-tools` from esm.sh - nip19, nip44

## Differences from v1

| Aspect | v1 (Deprecated) | v2 (Current) |
|--------|-----------------|--------------|
| URL format | `?keyteleport=` | `#keyteleport=` |
| Server sees blob | Yes | No |
| Inner encryption | NIP-49 (PIN) | NIP-44 (throwaway key) |
| Key retrieval | API callback to Welcome | Self-contained in blob |
| Unlock method | 6-digit PIN | Paste nsec |
| Trust validation | `KEYTELEPORT_WELCOME_PUBKEY` | Decryption success |
