# Wingman Design Document

## Overview

Wingman is an AI assistant that users can invoke within chat threads to get AI-powered responses. It uses OpenRouter as the LLM backend and appears as a bot user in the system.

## User Experience

### Invocation
- User types `/` anywhere in a message to trigger slash command autocomplete
- Autocomplete shows available commands (starting with `/wingman`)
- User selects `/wingman` or types it fully
- Can include additional instructions: `/wingman summarize this` or just `/wingman`

### Response
- Wingman responds as a message in the same thread
- Wingman is just a regular npub - profile (name, avatar) fetched like any other user
- While processing: "Wingman is thinking..." indicator shown in thread
- Complete response (no streaming) - message appears when fully generated

### Error Handling
- Detailed errors logged to console for debugging
- Simple, safe error message posted in thread (e.g., "Sorry, I couldn't process that request")

## Architecture

### Environment Variables

```
OR_API_KEY=sk-or-...           # OpenRouter API key
WINGMAN_KEY=nsec1...           # Wingman's Nostr private key (for identity + signing)
```

### Wingman Identity

Wingman is a regular user in the system - bots are just npubs:
- `npub` derived from `WINGMAN_KEY` using nostr-tools
- Profile (name, avatar, etc.) fetched from Nostr relays like any other user
- Stored in `users` table via normal upsertUser flow
- Messages authored by Wingman's npub, treated like any other message
- **Messages are signed** with WINGMAN_KEY (enables future encryption/federation features)

This approach means any bot is just an npub with a profile - no special bot handling needed.

### Admin Settings (Database)

New table for app-wide settings:

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Settings keys:
- `wingman_system_prompt` - System prompt for Wingman (default: "You are wingman, and you will be responding to user questions. Be direct, clever and kind.")
- `wingman_model` - OpenRouter model ID (default: `anthropic/claude-sonnet-4`)
- `wingman_enabled` - Enable/disable Wingman globally (`"true"` / `"false"`)

### Settings UI (Admin Only)

New section in settings page:
- Toggle: Enable Wingman
- Textarea: System prompt
- Dropdown/Input: Model selection (with presets + custom)

---

## Flow

### 1. Message Submission

```
User sends: "What do you think? /wingman"
                    ↓
         Server receives message
                    ↓
         Save message to DB (user's message)
                    ↓
         Detect /wingman trigger (slash command parser)
                    ↓
         Check: Is user admin? (for now)
                    ↓
         Process Wingman request (async, don't block response)
```

### 2. Wingman Processing

```
         Build thread context (via buildThreadContext())
                    ↓
         Build prompt:
           - System: admin-configured prompt
           - Context: formatted thread history
           - User: current message (with /wingman stripped)
                    ↓
         Call OpenRouter API
                    ↓
         On success: Create signed message from Wingman
         On error: Log details, post safe error message
                    ↓
         Broadcast via SSE
```

### 3. Context Format

Reuse copy-thread format:
```
[Alice - 2:30 PM]
Has anyone tried the new API?

[Bob - 2:32 PM]
Yeah, it's working well for me

[Alice - 2:35 PM]
What do you think? /wingman
```

**Note**: Context building is isolated in `buildThreadContext()` function for easy future modification (token limits, summarization, etc.)

### 4. Thinking Indicator

When `/wingman` is triggered:
1. Server broadcasts SSE event: `wingman:thinking` with `{ threadId, channelId }`
2. Client shows "Wingman is thinking..." in the thread (ephemeral, not persisted)
3. When Wingman's message arrives, the thinking indicator is automatically replaced

This uses the existing SSE infrastructure - just a new event type.

---

## Slash Command System

Extensible design, but only `/wingman` implemented for MVP.

### Client-Side
- Detect `/` in message input
- Show autocomplete dropdown with registered commands
- Filter as user types
- Commands registered in a simple array/config

### Server-Side

```typescript
// src/services/slashCommands.ts

interface SlashCommand {
  name: string;           // e.g., "wingman"
  description: string;    // For autocomplete tooltip
  adminOnly: boolean;     // Access control
  handler: (ctx: SlashCommandContext) => Promise<void>;
}

interface SlashCommandContext {
  message: Message;       // The triggering message
  author: string;         // npub of invoker
  channelId: number;
  threadRootId: number | null;
  args: string;           // Text after the command
}

// Registry
const commands: Map<string, SlashCommand> = new Map();

// Parser - extracts commands from message body
function parseSlashCommands(body: string): Array<{ command: string; args: string }>;

// Executor - runs after message is saved
async function executeSlashCommands(message: Message, authorNpub: string): Promise<void>;
```

### Initial Commands
- `/wingman [instructions]` - AI assistant (async)

### Future Commands (not implemented)
- `/summarize` - Summarize thread
- `/search <query>` - Search messages
- `/poll <question>` - Create a poll

---

## Key Functions

### `buildThreadContext(threadRootId: number): string`

Isolated function for building LLM context from thread messages.

```typescript
// src/services/wingman.ts

export function buildThreadContext(threadRootId: number): string {
  // Get all messages in thread
  // Format as [Author - Time]\nBody
  // Join with double newlines
  // Future: Add token counting, truncation, summarization
}
```

### `getWingmanIdentity(): { npub: string; pubkey: string; secretKey: Uint8Array } | null`

Derives Wingman's identity from env.

```typescript
export function getWingmanIdentity() {
  const nsec = process.env.WINGMAN_KEY;
  if (!nsec) return null;

  const { data: secretKey } = nip19.decode(nsec);
  const pubkey = getPublicKey(secretKey as Uint8Array);
  const npub = nip19.npubEncode(pubkey);

  return { npub, pubkey, secretKey: secretKey as Uint8Array };
}
```

### `callOpenRouter(systemPrompt: string, userContent: string, model: string): Promise<string>`

Calls OpenRouter API and returns response text.

```typescript
export async function callOpenRouter(
  systemPrompt: string,
  userContent: string,
  model: string
): Promise<string> {
  // POST to https://openrouter.ai/api/v1/chat/completions
  // Return response content
  // Throw on error (caller handles)
}
```

---

## Implementation Phases (Completed)

### Phase 1: Core Infrastructure
- [x] Add env vars to config (OR_API_KEY, WINGMAN_KEY)
- [x] Create `src/services/wingman.ts` with identity helpers
- [x] Create `app_settings` table in db.ts
- [x] Add settings CRUD functions (getSetting, setSetting)
- [x] Initialize Wingman user on startup (if key exists)

### Phase 2: Slash Command System
- [x] Create `src/services/slashCommands.ts`
- [x] Implement command parser (detect `/command` in message body)
- [x] Implement command registry and executor
- [x] Hook into message creation flow (post-save trigger)

### Phase 3: Wingman Command
- [x] Implement `/wingman` command handler
- [x] `buildThreadContext()` function
- [x] `callOpenRouter()` function
- [x] Create signed Wingman message and broadcast

### Phase 4: Admin Settings UI
- [x] Add Wingman section to settings page (admin only)
- [x] API endpoints for settings CRUD
- [x] Client-side settings management

### Phase 5: Client-Side Autocomplete
- [x] Slash command detection in message input
- [x] Autocomplete dropdown component
- [x] Command list endpoint for client

### Phase 6: Polish
- [x] "Wingman is thinking..." indicator in thread
- [x] Error message styling

---

## Technical Notes

### OpenRouter API

```typescript
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.OR_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://your-app.com", // Optional, for OpenRouter analytics
  },
  body: JSON.stringify({
    model: "anthropic/claude-sonnet-4",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: formattedThread }
    ]
  })
});

const data = await response.json();
return data.choices[0].message.content;
```

### Deriving Wingman Identity

```typescript
import { getPublicKey, nip19 } from "nostr-tools";

const nsec = process.env.WINGMAN_KEY;
const { data: secretKey } = nip19.decode(nsec);
const pubkey = getPublicKey(secretKey as Uint8Array);
const npub = nip19.npubEncode(pubkey);
```

### Signing Messages (Future Reference)

```typescript
import { finalizeEvent } from "nostr-tools";

const event = finalizeEvent({
  kind: 1, // or custom kind for chat
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: messageBody,
}, secretKey);
```

---

## Open Items (Deferred)

- **Rate limiting**: Not implemented in MVP
- **Context limits**: `buildThreadContext()` has no limits initially; edit function later as needed
- **Per-channel prompts**: Global prompt only for now
- **Streaming**: Complete responses only for MVP
