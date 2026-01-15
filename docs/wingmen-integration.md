# Wingmen Integration - Task Delivery System

## Overview

This document describes the integration between Marginalgains (task management) and Wingmen (AI agent orchestration) for autonomous task execution.

When a user sends a task to Wingmen, it is executed by an AI agent with automatic progress tracking and completion reporting via the Nightwatchman system.

**Related document:** See `wingmen/docs/nightwatchman.md` for the Wingmen-side architecture.

---

## Concepts

### Wingmen (External System)

Wingmen is an AI agent orchestration platform that can run sessions with various agents (Claude, Goose, Codex, etc.). It provides:
- Session management (start, stop, monitor)
- Real-time conversation streaming
- The Nightwatchman delivery system for reliable task completion

### Delivery

A Delivery is Wingmen's orchestration unit for executing a Marginalgains task. It:
- Runs a work session to perform the task
- Automatically reviews work via Nightwatchman when sessions stop
- Calls back to Marginalgains with progress updates
- Guarantees completion reporting

### Nightwatchman

A supervisor session in Wingmen that reviews work and decides:
- **CONTINUE**: Send instruction to resume work
- **COMPLETE**: Task is done, report summary

---

## User Experience

### Sending a Task to Wingmen

1. User views a task in Marginalgains
2. User clicks "Send to Wingman" button
3. Task moves to `in_progress`, assigned to Wingman
4. A note is added with link to the work session
5. User can click through to watch the agent work in real-time

### Progress Updates

As Wingmen works on the task, notes are automatically appended:
```
Task: Fix the login validation bug
State: in_progress
Assigned: Wingman

Notes:
- [Jan 15, 2:30 PM] Sent to Wingman - Work Session: [link]
- [Jan 15, 2:45 PM] Review 1: CONTINUE - "Need to run the test suite" [decision link]
- [Jan 15, 3:02 PM] Review 2: COMPLETE - "Fixed validation bug in auth.ts, all tests passing" [decision link]

→ Moved to: review
```

### Completion

When Wingmen reports completion:
- Final summary is added as a note
- Task moves to `review` state
- User reviews the work and either approves or sends back

---

## Data Model Changes

### Task Fields

No schema changes required. We use existing fields:
- `state`: `in_progress` while Wingmen is working, `review` when complete
- `assigned_to`: Wingman's npub
- `description`: Append structured notes for progress tracking

### Wingman Identity

Wingman is a regular npub in the system (same pattern as chat wingman):

```typescript
// Derived from WINGMAN_KEY in env
const wingmanNpub = getWingmanIdentity()?.npub;
```

The same `WINGMAN_KEY` used for chat wingman is used here. This means:
- Tasks assigned to Wingman show the same identity
- Consistent across chat responses and task work

### Structured Notes Format

Notes are appended to the task description in a parseable format:

```
---
[WINGMAN SESSION]
Delivery: del_abc123
Work Session: https://wingmen.local/live/sess_xyz
Started: 2025-01-15T14:30:00Z

[REVIEW 1 - 2025-01-15T14:45:00Z]
Decision: CONTINUE
Summary: Need to run the test suite
Session: https://wingmen.local/live/nw_001

[REVIEW 2 - 2025-01-15T15:02:00Z]
Decision: COMPLETE
Summary: Fixed validation bug in auth.ts, all tests passing
Session: https://wingmen.local/live/nw_002
---
```

---

## API Endpoints

### Send Task to Wingmen

**Endpoint:** `POST /api/tasks/:id/send-to-wingman`

**Request:**
```typescript
{
  workingDirectory: string    // e.g., "/Users/mini/code/myproject"
}
```

**Response:**
```typescript
{
  success: true,
  deliveryId: string,
  workSessionId: string,
  workSessionLink: string
}
```

**Behavior:**
1. Validates task exists and user can manage it
2. Calls Wingmen `POST /api/deliveries` with task details
3. Updates task:
   - State → `in_progress`
   - Assigned → Wingman npub
   - Description += session started note
4. Returns delivery info

**Errors:**
- `404`: Task not found
- `403`: User cannot manage this task
- `400`: Task already in progress with Wingmen
- `502`: Wingmen unavailable

### Wingmen Callback

**Endpoint:** `POST /api/wingman/callback`

**Request:**
```typescript
{
  // Authentication
  secret: string,

  // Task reference
  taskId: string,
  deliveryId: string,

  // Decision
  decision: "continue" | "complete" | "error" | "max_reviews" | "cancelled",
  summary: string,

  // Session links
  workSessionId: string,
  workSessionLink: string,
  decisionSessionId?: string,
  decisionSessionLink?: string,

  // Progress
  reviewNumber: number,
  maxReviews: number
}
```

**Response:** `200 OK` on success

**Behavior:**

For `continue`:
1. Validate secret
2. Append review note to task description
3. Return 200 (Wingmen handles the continuation)

For `complete`:
1. Validate secret
2. Append final review note to task description
3. Move task to `review` state
4. Return 200

For `max_reviews`:
1. Append note indicating max reviews reached
2. Move task to `review` state
3. Return 200

For `error` or `cancelled`:
1. Append error note to task description
2. Move task to `review` state (for human attention)
3. Return 200

**Errors:**
- `401`: Invalid secret
- `404`: Task not found
- `400`: Invalid payload

---

## Configuration

### Environment Variables

```bash
# Wingmen connection
WINGMEN_BASE_URL=http://localhost:3600    # Wingmen server URL
WINGMEN_CALLBACK_SECRET=your-secret-here  # Shared secret for callbacks

# Already exists (used for both chat and task wingman)
WINGMAN_KEY=nsec1...                      # Wingman's Nostr private key
```

### Callback URL

Marginalgains must be reachable from Wingmen for callbacks:

```
# For local development (same machine)
Callback URL: http://localhost:3000/api/wingman/callback

# For production
Callback URL: https://mg.otherstuff.ai/api/wingman/callback
```

The callback URL is passed to Wingmen when creating a delivery.

---

## Implementation Plan

### Phase 1: Configuration

**Files:**
- `src/config.ts` - Add Wingmen config

**Tasks:**
1. Add `WINGMEN_BASE_URL` to config
2. Add `WINGMEN_CALLBACK_SECRET` to config
3. Helper to get callback URL (construct from server's base URL)

### Phase 2: Callback Endpoint

**Files:**
- `src/routes/wingman-callback.ts` - New route handler
- `src/services/wingman-tasks.ts` - Business logic

**Tasks:**
1. Create callback route handler
2. Validate secret
3. Parse callback payload
4. Append note to task description
5. Transition task state if needed

### Phase 3: Send to Wingmen Action

**Files:**
- `src/routes/tasks.ts` - Add send-to-wingman endpoint
- `src/services/wingman-tasks.ts` - Add send logic

**Tasks:**
1. Add `POST /api/tasks/:id/send-to-wingman` endpoint
2. Build delivery request payload
3. Call Wingmen API
4. Update task (state, assigned, note)

### Phase 4: UI Integration

**Files:**
- `src/render/todo-detail.ts` - Add send button
- `public/todos.js` - Handle button click

**Tasks:**
1. Add "Send to Wingman" button on task detail view
2. Show only for tasks not already in progress with Wingmen
3. Prompt for working directory (or use project default)
4. Call API and show result

### Phase 5: Working Directory Management

**Tasks:**
1. Consider adding project/directory association to tasks
2. Or use a default directory per board/group
3. For now: manual entry in send dialog

---

## Service Functions

### `src/services/wingman-tasks.ts`

```typescript
import { getWingmanIdentity } from "./wingman";

interface SendToWingmanInput {
  taskId: number;
  workingDirectory: string;
  userNpub: string;  // For permission check
}

interface SendToWingmanResult {
  deliveryId: string;
  workSessionId: string;
  workSessionLink: string;
}

/**
 * Send a task to Wingmen for execution
 */
export async function sendTaskToWingman(
  input: SendToWingmanInput
): Promise<SendToWingmanResult> {
  // 1. Get task
  // 2. Validate user can manage task
  // 3. Check task not already with Wingmen
  // 4. Build delivery payload
  // 5. POST to Wingmen /api/deliveries
  // 6. Update task (state, assigned, note)
  // 7. Return result
}

interface WingmanCallbackInput {
  secret: string;
  taskId: string;
  deliveryId: string;
  decision: "continue" | "complete" | "error" | "max_reviews" | "cancelled";
  summary: string;
  workSessionId: string;
  workSessionLink: string;
  decisionSessionId?: string;
  decisionSessionLink?: string;
  reviewNumber: number;
  maxReviews: number;
}

/**
 * Handle callback from Wingmen
 */
export async function handleWingmanCallback(
  input: WingmanCallbackInput
): Promise<void> {
  // 1. Validate secret
  // 2. Get task by ID
  // 3. Append note based on decision
  // 4. If complete/max_reviews/error: transition to review
}

/**
 * Build a structured note for the task description
 */
function buildWingmanNote(
  type: "started" | "review",
  data: Record<string, unknown>
): string {
  // Format note in parseable structure
}

/**
 * Append a note to task description
 */
function appendNoteToTask(taskId: number, note: string): void {
  // Get current description
  // Append note with separator
  // Update task
}
```

---

## Callback Route Handler

### `src/routes/wingman-callback.ts`

```typescript
import { handleWingmanCallback } from "../services/wingman-tasks";
import { WINGMEN_CALLBACK_SECRET } from "../config";

export async function handleWingmanCallbackRoute(
  request: Request
): Promise<Response> {
  // Parse JSON body
  const body = await request.json();

  // Validate required fields
  if (!body.secret || !body.taskId || !body.decision) {
    return new Response(
      JSON.stringify({ error: "Missing required fields" }),
      { status: 400 }
    );
  }

  // Validate secret
  if (body.secret !== WINGMEN_CALLBACK_SECRET) {
    return new Response(
      JSON.stringify({ error: "Invalid secret" }),
      { status: 401 }
    );
  }

  try {
    await handleWingmanCallback(body);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("[wingman-callback] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500 }
    );
  }
}
```

---

## Security Considerations

### Shared Secret

- Generate a strong random secret for `WINGMEN_CALLBACK_SECRET`
- Same secret configured in both Marginalgains and passed to Wingmen
- Validates that callbacks originate from Wingmen

### Localhost Assumption

Initial implementation assumes both services on same host:
- Callback URL uses localhost
- No HTTPS required for local traffic

For production deployment:
- Use HTTPS for callback URL
- Consider IP allowlist or additional auth

### Task Permissions

- Only users who can manage a task can send it to Wingmen
- Group tasks: group creators and team owners/managers
- Personal tasks: task owner only

---

## Error Handling

### Wingmen Unavailable

If Wingmen API call fails:
- Return 502 to client
- Do not modify task state
- User can retry later

### Callback Failures

If callback processing fails:
- Log error with full context
- Return 500 to Wingmen
- Wingmen may retry (depends on Wingmen's retry logic)
- Task may be left in inconsistent state (manual cleanup needed)

### Task Not Found

If callback references unknown task:
- Log warning
- Return 404
- Wingmen will record delivery as failed

---

## Testing

### Manual Testing Flow

1. Create a task in Marginalgains
2. Click "Send to Wingman"
3. Enter working directory
4. Verify:
   - Task moves to `in_progress`
   - Note added with session link
   - Can click through to Wingmen session

5. Let agent work (or manually stop session)
6. Verify:
   - Nightwatchman review starts
   - Callback received
   - Note added with review decision

7. If CONTINUE:
   - Verify continuation instruction sent
   - Work session resumes

8. If COMPLETE:
   - Verify task moves to `review`
   - Final summary in notes

### Callback Testing

```bash
# Test callback endpoint directly
curl -X POST http://localhost:3000/api/wingman/callback \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-secret",
    "taskId": "123",
    "deliveryId": "del_abc",
    "decision": "complete",
    "summary": "Fixed the bug",
    "workSessionId": "sess_xyz",
    "workSessionLink": "http://localhost:3600/live/sess_xyz",
    "reviewNumber": 1,
    "maxReviews": 3
  }'
```

---

## Future Enhancements

### Project Association

- Link tasks to projects with known working directories
- Eliminate need to manually enter directory

### Batch Operations

- Send multiple tasks to Wingmen
- Parallel execution with progress dashboard

### Task Templates

- Pre-configured task types with Wingmen prompts
- "Bug fix", "Feature implementation", "Code review"

### Progress Streaming

- Real-time updates in Marginalgains UI
- Don't require clicking through to Wingmen

### Bidirectional Sync

- Wingmen can create tasks in Marginalgains
- Full task management from agent sessions
