# Welcome Groups API Documentation

## Overview

The Welcome Groups API allows authorized applications to query which groups a user belongs to. This enables apps like Marginal Gains to implement group-based access control and team mapping.

**Base URL:** `https://welcome.otherstuff.ai`

---

## Authentication: NIP-98

All requests must be authenticated using [NIP-98 HTTP Auth](https://github.com/nostr-protocol/nips/blob/master/98.md).

### How NIP-98 Works

1. Create a Nostr event (kind 27235) with the request details
2. Sign it with your app's private key
3. Base64 encode the signed event
4. Include in the `Authorization` header

### Authorization Requirements

- The signing key **must match** a `teleport_pubkey` registered for an app in Welcome
- Apps are registered via Welcome's admin panel
- Only registered apps can query user groups

---

## Endpoint: Get User Groups

```
GET /api/user/groups?npub={npub}
```

### Request

**Query Parameters:**
| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `npub`    | string | Yes      | User's npub (bech32 format, starts with `npub1`) |

**Headers:**
| Header          | Value                              |
|-----------------|------------------------------------|
| `Authorization` | `Nostr <base64-encoded-event>`     |

### NIP-98 Event Structure

```json
{
  "kind": 27235,
  "created_at": 1705312800,
  "tags": [
    ["u", "https://welcome.otherstuff.ai/api/user/groups?npub=npub1abc..."],
    ["method", "GET"]
  ],
  "content": "",
  "pubkey": "<your-app-pubkey-hex>",
  "id": "<event-id>",
  "sig": "<signature>"
}
```

**Event Requirements:**
- `kind`: Must be `27235`
- `created_at`: Must be within 60 seconds of server time
- `u` tag: Must exactly match the full request URL (including query params)
- `method` tag: Must match the HTTP method (`GET`)
- Signature must be valid

### Response

**Success (200):**
```json
{
  "success": true,
  "npub": "npub1abc123...",
  "groups": [
    {
      "id": 1,
      "name": "speedrunners",
      "assigned_at": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "name": "team-mgapp",
      "assigned_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `npub parameter is required` | Missing npub query param |
| 400 | `Invalid npub format` | npub doesn't start with `npub1` |
| 401 | `Authorization header required` | Missing auth header |
| 401 | `Invalid authorization scheme` | Header doesn't start with `Nostr ` |
| 401 | `Invalid base64 encoding` | Can't decode base64 |
| 401 | `Invalid JSON in authorization` | Event isn't valid JSON |
| 401 | `Invalid event kind` | Kind isn't 27235 |
| 401 | `Event timestamp too old or too far in future` | created_at outside 60s window |
| 401 | `URL mismatch in authorization` | `u` tag doesn't match request URL |
| 401 | `Method mismatch in authorization` | `method` tag doesn't match |
| 401 | `Invalid event signature` | Signature verification failed |
| 403 | `Unauthorized: App not registered` | Signing key not registered as app |
| 500 | `Internal server error` | Server error |

---

## Implementation Example (TypeScript/Bun)

```typescript
import { finalizeEvent, nip19 } from "nostr-tools";

const WELCOME_API_URL = "https://welcome.otherstuff.ai";
const APP_PRIVKEY = process.env.WELCOME_API_PRIVKEY; // nsec or hex

function getSecretKey(): Uint8Array {
  if (APP_PRIVKEY.startsWith("nsec1")) {
    const decoded = nip19.decode(APP_PRIVKEY);
    return decoded.data as Uint8Array;
  }
  // Convert hex to Uint8Array
  return new Uint8Array(
    APP_PRIVKEY.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
  );
}

export async function getUserGroups(npub: string): Promise<UserGroupsResponse> {
  const url = `${WELCOME_API_URL}/api/user/groups?npub=${encodeURIComponent(npub)}`;

  // Create NIP-98 auth event
  const authEvent = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", "GET"]
    ],
    content: ""
  }, getSecretKey());

  // Base64 encode the signed event
  const authHeader = "Nostr " + btoa(JSON.stringify(authEvent));

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": authHeader
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

interface UserGroupsResponse {
  success: boolean;
  npub: string;
  groups: Array<{
    id: number;
    name: string;
    assigned_at: string;
  }>;
}
```

---

## Implementation Example (JavaScript/Browser)

For browser-side implementation where the app's private key is available:

```javascript
import { finalizeEvent, nip19 } from "nostr-tools";

async function getUserGroupsFromWelcome(npub, appPrivkey) {
  const WELCOME_API_URL = "https://welcome.otherstuff.ai";
  const url = `${WELCOME_API_URL}/api/user/groups?npub=${encodeURIComponent(npub)}`;

  // Decode private key
  let secretKey;
  if (appPrivkey.startsWith("nsec1")) {
    const decoded = nip19.decode(appPrivkey);
    secretKey = decoded.data;
  } else {
    secretKey = hexToBytes(appPrivkey);
  }

  // Create and sign NIP-98 event
  const authEvent = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", "GET"]
    ],
    content: ""
  }, secretKey);

  // Make authenticated request
  const response = await fetch(url, {
    headers: {
      "Authorization": "Nostr " + btoa(JSON.stringify(authEvent))
    }
  });

  return response.json();
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
```

---

## Special Groups

### `team-mgapp`

This group indicates the user has requested access to Marginal Gains. When detected:

1. Show user: "You have requested access to Marginal Gains"
2. Create an access request for admin review
3. Do NOT auto-add user to any team

### Other Groups

Groups like `speedrunners`, `speedrun2026`, etc. can be:
- Mapped directly to Marginal Gains teams with matching names
- Used for display/informational purposes during admin approval
- Auto-created as teams if they don't exist (configurable)

---

## Group Assignment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         WELCOME                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Admin creates invite code "speedrun2026"                     │
│  2. Links invite code to groups: ["team-mgapp", "speedrunners"]  │
│  3. User signs up with invite code                               │
│  4. User automatically joins both groups                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MARGINAL GAINS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  5. User teleports key to Marginal Gains                         │
│  6. MG server queries Welcome: GET /api/user/groups?npub=...     │
│  7. Welcome returns: ["team-mgapp", "speedrunners"]              │
│  8. MG detects "team-mgapp" → creates access request             │
│  9. Admin sees request with user info + groups                   │
│  10. Admin approves → user added to teams, keys encrypted        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Registering Your App in Welcome

To use this API, your app must be registered in Welcome:

1. Log in to Welcome admin panel
2. Go to Apps section
3. Create or edit your app
4. Set the **Teleport Pubkey** field to your app's public key (npub or hex)
5. Save

The private key corresponding to this pubkey is what you'll use to sign NIP-98 requests.

---

## Rate Limits

- **Per-app:** 100 requests per minute
- **Per-user:** 10 requests per minute per npub

Exceeding limits returns `429 Too Many Requests`.

---

## Testing

### Test with cURL

```bash
# This won't work directly - you need to generate a signed event
# Use the TypeScript/JavaScript examples above to generate the auth header

curl -X GET \
  "https://welcome.otherstuff.ai/api/user/groups?npub=npub1abc..." \
  -H "Authorization: Nostr eyJraW5kIjoyNzIzNS4uLn0="
```

### Verify Your Setup

1. Ensure your app is registered in Welcome with correct `teleport_pubkey`
2. Verify your signing key matches the registered pubkey
3. Check that `created_at` is current (within 60 seconds)
4. Ensure the `u` tag exactly matches your request URL

---

## Changelog

- **v1.0** (2024-01): Initial release with NIP-98 authentication
