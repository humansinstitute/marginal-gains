# Nostr Connect Implementation

This document describes the NIP-46 Nostr Connect implementation for mobile signer support.

## Overview

Nostr Connect allows users to authenticate using a mobile signer app (Amber, Nostrsigner, etc.) by scanning a QR code or copying a `nostrconnect://` URI. The app generates a connection request, waits for the signer to connect, then uses the remote signer for authentication.

## NIP-46 Specification Reference

- **Protocol**: `nostrconnect://`
- **Event Kind**: 24133 (encrypted JSON-RPC messages)
- **Encryption**: NIP-44

### URI Format

```
nostrconnect://<client-pubkey>?relay=<wss://relay>&secret=<random>&name=<app>&url=<origin>&image=<favicon>
```

## Files Modified

### Server-Side

#### `src/config.ts`
- Added `DEFAULT_RELAYS` array with fallback relays
- Added `NOSTR_RELAYS` env var support (comma-separated list)

```typescript
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.devvul.com",
  "wss://purplepag.es",
];
export const NOSTR_RELAYS: string[] = Bun.env.NOSTR_RELAYS
  ? Bun.env.NOSTR_RELAYS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_RELAYS;
```

#### `src/render/landing.ts`
- Imported `NOSTR_RELAYS` from config
- Added "Nostr Connect" button in Advanced Options section
- Added `renderNostrConnectModal()` function for the modal UI
- Updated `renderSessionSeed()` to pass relays and app metadata to client:
  - `window.__NOSTR_RELAYS__`
  - `window.__APP_NAME__`
  - `window.__APP_FAVICON__`

#### `src/render/settings.ts`
- Added `renderAccountSection()` function showing login method
- Shows "Clear Bunker Connection" button for bunker users

### Client-Side

#### `public/constants.js`
- Added `BUNKER_CONNECTION_KEY = "nostr_bunker_connection"` for localStorage persistence
- Added `getRelays()` function to use server config or fall back to defaults

#### `public/nostr.js`
- Updated `loadNostrLibs()` to load additional modules:
  - `nip44` - for NIP-44 encryption/decryption
  - `SimplePool` - for relay pool management

#### `public/auth.js`

**New imports:**
- `BUNKER_CONNECTION_KEY`, `getRelays` from constants.js

**New functions:**

`wireNostrConnectModal()` - Wires up modal event listeners (open, close, copy URI)

`openNostrConnectModal()` - Main flow:
1. Generate ephemeral client keypair
2. Generate random secret for verification
3. Build `nostrconnect://` URI with app metadata
4. Render QR code using qrcode library
5. Display URI in copyable text input
6. Start 60-second countdown timer
7. Subscribe to relays for kind 24133 events
8. On connection, store bunker data and complete login

`waitForNostrConnect(clientSecretKey, clientPubkey, secret, relays, signal)` - Listens for signer response:
1. Subscribe to kind 24133 events tagged to client pubkey
2. Decrypt incoming messages with NIP-44
3. Verify secret matches
4. Request `get_public_key` from signer
5. Request `sign_event` for login event
6. Return signed event and signer pubkey

`requestFromSigner(pool, relays, clientSecretKey, clientPubkey, remoteSignerPubkey, request)` - Send encrypted request to signer:
1. Generate request ID
2. Encrypt request with NIP-44
3. Publish kind 24133 event
4. Subscribe for response
5. Decrypt and return result

`closeNostrConnectModal()` - Cleanup timer and abort controller

**Updated functions:**

`maybeAutoLogin()` - Added bunker auto-login support:
- Reads stored connection from `BUNKER_CONNECTION_KEY`
- Reconnects to signer and requests new login event

`completeLogin()` - Added bunker case to preserve auto-login settings

`clearAutoLogin()` - Now also clears `BUNKER_CONNECTION_KEY`

**New exports:**
- `clearBunkerConnection()` - Clears bunker data from localStorage
- `hasBunkerConnection()` - Checks if bunker connection exists

#### `public/settings.js`
- Imports `clearBunkerConnection`, `hasBunkerConnection` from auth.js
- Added `initAccountSection()` function:
  - Shows current login method
  - Shows bunker settings panel if method is "bunker"
  - Wires "Clear Bunker Connection" button

#### `public/app.css`

**Nostr Connect Modal styles** (`.nostr-connect-*`):
- Overlay with backdrop blur
- Centered modal card
- QR code container
- URI input with copy button
- Status and timer text
- Cancel button

**Nostr Connect Button** (`.auth-nostr-connect`):
- Orange background (#f97316)
- Full width in advanced options

**Account Settings** (`.account-*`, `.bunker-*`):
- Login method display
- Bunker settings panel with danger button

## Connection Flow

```
1. User clicks "Nostr Connect" button
2. App generates ephemeral keypair + random secret
3. App displays QR code / URI with nostrconnect://
4. User scans with mobile signer (Amber, etc.)
5. Signer connects to relay, sends "connect" response with secret
6. App verifies secret matches
7. App requests get_public_key -> receives user's pubkey
8. App requests sign_event -> receives signed login event
9. App stores connection data in localStorage
10. App completes login with signed event
11. On return visits, app reconnects using stored data
```

## Persistence

Bunker connection stored in localStorage under `nostr_bunker_connection`:

```json
{
  "clientSecretKey": "<hex>",
  "remoteSignerPubkey": "<hex>",
  "relays": ["wss://..."]
}
```

Auto-login method stored as `"bunker"` in `nostr_auto_login_method`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NOSTR_RELAYS` | (hardcoded defaults) | Comma-separated relay URLs |

## Dependencies Added

- `qrcode@1.5.4` - QR code generation for canvas

## Security Considerations

- Requires HTTPS (uses `crypto.randomUUID()`)
- Secret parameter prevents connection spoofing
- NIP-44 encryption for all signer communication
- Client keypair is ephemeral per connection
- Stored connection can be cleared from settings

## Testing

1. Navigate to login page
2. Click "Advanced Options"
3. Click "Nostr Connect" (orange button)
4. Scan QR with Amber/Nostrsigner or copy URI
5. Approve connection in signer app
6. Verify login completes
7. Log out and verify auto-login works
8. Go to Settings > Account > Clear Bunker Connection
