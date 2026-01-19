# Welcome Integration: Invite Code Linking

## Overview

A simple integration between Welcome and Marginal Gains that allows users who sign up through Welcome to automatically join the correct team in MG.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          WELCOME (Admin)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Admin creates invite code "speedrun2026" in MG                       │
│  2. Admin creates invite code "join-speedrun" in Welcome                 │
│  3. Admin links MG invite code to Welcome invite code:                   │
│     Welcome invite "join-speedrun" → MG invite "XXXX-XXXX-XXXX"          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER SIGNUP FLOW                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  4. User signs up at Welcome with invite code "join-speedrun"            │
│  5. Welcome stores the MG invite code link against the user              │
│  6. User clicks "Key Teleport" to Marginal Gains                         │
│  7. MG receives teleported key, logs user in                             │
│  8. MG queries Welcome: GET /api/user/app-invite?npub=...                │
│  9. Welcome returns: { invite_code: "XXXX-XXXX-XXXX" }                   │
│  10. MG redirects to /?code=XXXX-XXXX-XXXX                               │
│  11. User is automatically joined to the team via existing invite flow   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implemented Components

### Marginal Gains (Server)

**`src/config.ts`**
- `WELCOME_API_URL` - Welcome API base URL (default: https://welcome.otherstuff.ai)
- Uses existing `KEYTELEPORT_PRIVKEY` for NIP-98 signing

**`src/services/welcome-api.ts`**
- `createNip98AuthHeader(url, method)` - Creates NIP-98 Authorization header
- `getUserGroups(npub)` - Fetches user's groups from Welcome
- `getUserInviteCode(npub)` - Fetches linked MG invite code for user

**`src/routes/welcome.ts`**
- `GET /api/welcome/groups` - Returns user's Welcome groups
- `GET /api/welcome/invite-code` - Returns linked MG invite code

### Marginal Gains (Client)

**`public/auth.js`**
- Modified `checkKeyTeleport()` to:
  1. Complete login with `skipRedirect: true`
  2. Fetch `/api/welcome/invite-code`
  3. If invite code found, redirect to `/?code={inviteCode}`
  4. Otherwise, do normal redirect

### Welcome (Server - Not Yet Implemented)

**Needed Endpoints:**
- `GET /api/user/app-invite?npub=...` - Returns linked app invite code
  - Authenticated with NIP-98 (same as groups endpoint)
  - Looks up invite code stored against user's Welcome account

**Needed Admin UI:**
- When editing an invite code, ability to link an external app invite code
- Field: "MG Invite Code" (optional)

## Environment Variables

```bash
# Marginal Gains .env
WELCOME_API_URL=https://welcome.otherstuff.ai
KEYTELEPORT_PRIVKEY=nsec1...  # Also used for NIP-98 signing to Welcome
```

## API Details

### GET /api/user/app-invite

**Request:**
```
GET /api/user/app-invite?npub=npub1abc...
Authorization: Nostr <base64-encoded-signed-event>
```

**NIP-98 Event:**
```json
{
  "kind": 27235,
  "created_at": 1705312800,
  "tags": [
    ["u", "https://welcome.otherstuff.ai/api/user/app-invite?npub=npub1abc..."],
    ["method", "GET"]
  ],
  "content": "",
  "pubkey": "<MG-teleport-pubkey>",
  "sig": "..."
}
```

**Success Response (200):**
```json
{
  "success": true,
  "npub": "npub1abc...",
  "invite_code": "XXXX-XXXX-XXXX",
  "app_id": 1
}
```

**No Invite Code (200):**
```json
{
  "success": true,
  "npub": "npub1abc...",
  "invite_code": null
}
```

**Not Found (404):**
```json
{
  "success": false,
  "error": "User not found"
}
```

## Benefits of This Approach

1. **Simple** - Uses existing MG invite code infrastructure
2. **Zero new tables** - Just one optional field on Welcome invite codes
3. **Existing UX** - Users see familiar invite redemption flow
4. **Flexible** - Not all Welcome invites need MG links
5. **Secure** - NIP-98 auth ensures only authorized apps can query

## Comparison with Groups Approach

| Aspect | Invite Code Linking | Groups Approach |
|--------|---------------------|-----------------|
| Complexity | Low | High |
| New tables | 0 | 4+ |
| Admin work | Link codes | Manage groups, approve requests |
| User experience | Automatic join | Wait for approval |
| Flexibility | Per-invite | Per-group |

## Next Steps (Welcome Side)

1. Add `app_invite_code` column to `invite_codes` table
2. Add UI field when editing invite codes
3. Create `/api/user/app-invite` endpoint
4. Test end-to-end flow
