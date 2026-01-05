/**
 * SSE client for real-time updates
 * Connects to server event stream and updates local state/UI
 */

import {
  initLocalDb,
  saveChannel,
  saveChannels,
  saveMessage,
  deleteChannel as deleteLocalChannel,
  updateChannel as updateLocalChannel,
  getChannelsByType,
} from "./localDb.js";
import {
  state,
  updateAllChannels,
  upsertChannel,
  addMessage as addMessageToState,
  setChannelMessages,
} from "./state.js";
import { elements as el } from "./dom.js";
import { decryptMessageFromChannel } from "./chatCrypto.js";

// Check if scroll container is near bottom (within threshold)
function isNearBottom(container) {
  if (!container) return true;
  const threshold = 100;
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

let eventSource = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000; // 30 seconds max

// Event handlers that can be registered by the app
const eventHandlers = {
  "message:new": [],
  "message:delete": [],
  "channel:new": [],
  "channel:update": [],
  "channel:delete": [],
  "dm:new": [],
  "sync:init": [],
  "connection:change": [],
  "wingman:thinking": [],
};

/**
 * Register a handler for a specific event type
 */
export function onEvent(eventType, handler) {
  if (eventHandlers[eventType]) {
    eventHandlers[eventType].push(handler);
  }
}

/**
 * Remove a handler for a specific event type
 */
export function offEvent(eventType, handler) {
  if (eventHandlers[eventType]) {
    eventHandlers[eventType] = eventHandlers[eventType].filter((h) => h !== handler);
  }
}

/**
 * Emit an event to all registered handlers
 */
function emitEvent(eventType, data) {
  if (eventHandlers[eventType]) {
    for (const handler of eventHandlers[eventType]) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[LiveUpdates] Error in ${eventType} handler:`, err);
      }
    }
  }
}

/**
 * Connect to the SSE endpoint
 */
export async function connect() {
  if (!state.session) {
    console.log("[LiveUpdates] No session, skipping connection");
    return;
  }

  // Initialize local database
  try {
    await initLocalDb();
  } catch (err) {
    console.error("[LiveUpdates] Failed to initialize local database:", err);
  }

  // Close existing connection if any
  disconnect();

  console.log("[LiveUpdates] Connecting to event stream...");

  eventSource = new EventSource("/chat/events");

  eventSource.onopen = () => {
    console.log("[LiveUpdates] Connected to event stream");
    reconnectAttempts = 0;
    emitEvent("connection:change", { state: "connected" });
  };

  eventSource.onerror = (err) => {
    console.error("[LiveUpdates] Connection error:", err);
    eventSource.close();
    emitEvent("connection:change", { state: "disconnected" });
    scheduleReconnect();
  };

  // Handle initial sync
  eventSource.addEventListener("sync:init", async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[LiveUpdates] Received initial sync:", data);
      await handleInitialSync(data);
      emitEvent("sync:init", data);
    } catch (err) {
      console.error("[LiveUpdates] Error handling sync:init:", err);
    }
  });

  // Handle new messages
  eventSource.addEventListener("message:new", async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[LiveUpdates] New message:", data);
      const { wasNearBottom } = await handleNewMessage(data);
      // Include pre-captured scroll state in the event data
      emitEvent("message:new", { ...data, wasNearBottom });
    } catch (err) {
      console.error("[LiveUpdates] Error handling message:new:", err);
    }
  });

  // Handle new channels
  eventSource.addEventListener("channel:new", async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[LiveUpdates] New channel:", data);
      await handleNewChannel(data);
      emitEvent("channel:new", data);
    } catch (err) {
      console.error("[LiveUpdates] Error handling channel:new:", err);
    }
  });

  // Handle channel updates
  eventSource.addEventListener("channel:update", async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[LiveUpdates] Channel update:", data);
      await handleChannelUpdate(data);
      emitEvent("channel:update", data);
    } catch (err) {
      console.error("[LiveUpdates] Error handling channel:update:", err);
    }
  });

  // Handle channel deletions
  eventSource.addEventListener("channel:delete", async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[LiveUpdates] Channel deleted:", data);
      await handleChannelDelete(data);
      emitEvent("channel:delete", data);
    } catch (err) {
      console.error("[LiveUpdates] Error handling channel:delete:", err);
    }
  });

  // Handle new DM channels
  eventSource.addEventListener("dm:new", async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[LiveUpdates] New DM:", data);
      await handleNewDm(data);
      emitEvent("dm:new", data);
    } catch (err) {
      console.error("[LiveUpdates] Error handling dm:new:", err);
    }
  });

  // Handle Wingman thinking indicator
  eventSource.addEventListener("wingman:thinking", (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[LiveUpdates] Wingman thinking:", data);
      emitEvent("wingman:thinking", data);
    } catch (err) {
      console.error("[LiveUpdates] Error handling wingman:thinking:", err);
    }
  });
}

/**
 * Disconnect from SSE
 */
export function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (eventSource) {
    eventSource.close();
    eventSource = null;
    console.log("[LiveUpdates] Disconnected from event stream");
  }
}

/**
 * Schedule a reconnection attempt with exponential backoff
 */
function scheduleReconnect() {
  if (reconnectTimeout) return;

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;

  console.log(`[LiveUpdates] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  emitEvent("connection:change", { state: "connecting" });
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, delay);
}

// ========== Event Handlers ==========

/**
 * Handle initial sync data from server
 * NOTE: We now fetch channels via HTTP first, so this only saves to local DB
 * and doesn't overwrite app state (HTTP is more reliable for initial load)
 */
async function handleInitialSync(data) {
  const { channels, dmChannels, personalChannel } = data;

  // Save to local database for offline support
  try {
    if (channels?.length > 0) {
      await saveChannels(channels, "channel");
    }
    if (dmChannels?.length > 0) {
      await saveChannels(dmChannels, "dm");
    }
    if (personalChannel) {
      await saveChannel(personalChannel, "personal");
    }
  } catch (err) {
    console.error("[LiveUpdates] Error saving sync data to local DB:", err);
  }

  // Don't update app state - HTTP fetch handles initial channel load
  // SSE sync:init is only used for local DB caching now
}

/**
 * Handle new message event
 */
async function handleNewMessage(data) {
  const { channelId, ...rawMessage } = data;

  // IMPORTANT: Capture scroll position BEFORE adding to state
  // (adding to state triggers refreshUI which re-renders the DOM)
  const isViewingChannel = state.chat.selectedChannelId === String(channelId);
  const wasNearBottom = isViewingChannel ? isNearBottom(el.chatThreadList) : false;

  // Save raw message to local database
  try {
    await saveMessage({ ...rawMessage, channelId });
  } catch (err) {
    console.error("[LiveUpdates] Error saving message to local DB:", err);
  }

  // Transform message to match UI expected format
  // (same transformation as fetchMessages in chat.js)
  let messageBody = rawMessage.body;
  let decryptedSender = null;
  let decryptionFailed = false;
  const isEncrypted = rawMessage.encrypted === 1;

  // Decrypt if message is encrypted - trust the message's encrypted flag directly
  // (don't rely on isChannelEncrypted which depends on state that might not be loaded)
  if (isEncrypted) {
    console.log("[LiveUpdates] Decrypting message:", rawMessage.id);
    try {
      const result = await decryptMessageFromChannel(rawMessage.body, String(channelId));
      if (result && result.valid) {
        messageBody = result.content;
        decryptedSender = result.sender;
        console.log("[LiveUpdates] Decrypted successfully");
      } else if (result && !result.valid) {
        messageBody = "[Message signature invalid]";
        decryptionFailed = true;
        console.warn("[LiveUpdates] Message signature invalid");
      } else {
        messageBody = "[Unable to decrypt - no key available]";
        decryptionFailed = true;
        console.warn("[LiveUpdates] No key available for decryption");
      }
    } catch (err) {
      console.error("[LiveUpdates] Error decrypting message:", err);
      messageBody = "[Decryption failed]";
      decryptionFailed = true;
    }
  }

  const message = {
    id: String(rawMessage.id),
    channelId: String(channelId),
    author: rawMessage.author,
    body: messageBody,
    createdAt: rawMessage.created_at,
    parentId: rawMessage.parent_id ? String(rawMessage.parent_id) : null,
    threadRootId: rawMessage.thread_root_id ? String(rawMessage.thread_root_id) : null,
    encrypted: isEncrypted,
    decryptedSender,
    decryptionFailed,
  };

  // Add to app state if this channel's messages are loaded
  addMessageToState(String(channelId), message);

  // Return the pre-captured scroll state for the event handler
  return { wasNearBottom };
}

/**
 * Handle new channel event
 */
async function handleNewChannel(data) {
  // Save to local database
  try {
    await saveChannel(data, "channel");
  } catch (err) {
    console.error("[LiveUpdates] Error saving channel to local DB:", err);
  }

  // Add to app state
  upsertChannel({
    id: String(data.id),
    name: data.name,
    displayName: data.displayName,
    description: data.description,
    isPublic: data.isPublic,
  });
}

/**
 * Handle channel update event
 */
async function handleChannelUpdate(data) {
  // Update in local database
  try {
    await updateLocalChannel(data.id, data);
  } catch (err) {
    console.error("[LiveUpdates] Error updating channel in local DB:", err);
  }

  // Update in app state
  const existing = state.chat.channels.find((c) => c.id === String(data.id));
  if (existing) {
    existing.name = data.name;
    existing.displayName = data.displayName;
    existing.description = data.description;
    existing.isPublic = data.isPublic;
  }
}

/**
 * Handle channel delete event
 */
async function handleChannelDelete(data) {
  const { id } = data;

  // Delete from local database
  try {
    await deleteLocalChannel(id);
  } catch (err) {
    console.error("[LiveUpdates] Error deleting channel from local DB:", err);
  }

  // Remove from app state
  state.chat.channels = state.chat.channels.filter((c) => c.id !== String(id));

  // If this was the selected channel, clear selection
  if (state.chat.selectedChannelId === String(id)) {
    state.chat.selectedChannelId = null;
  }
}

/**
 * Handle new DM channel event
 */
async function handleNewDm(data) {
  // Save to local database
  try {
    await saveChannel(data, "dm");
  } catch (err) {
    console.error("[LiveUpdates] Error saving DM to local DB:", err);
  }

  // Add to app state DM list
  const dmChannel = {
    id: String(data.id),
    name: data.name,
    displayName: data.displayName,
    description: data.description,
    otherNpub: data.otherNpub,
  };

  // Check if already exists
  const exists = state.chat.dmChannels.find((c) => c.id === dmChannel.id);
  if (!exists) {
    state.chat.dmChannels.push(dmChannel);
  }
}

/**
 * Check if connected
 */
export function isConnected() {
  return eventSource?.readyState === EventSource.OPEN;
}

/**
 * Get connection state
 */
export function getConnectionState() {
  if (!eventSource) return "disconnected";
  switch (eventSource.readyState) {
    case EventSource.CONNECTING:
      return "connecting";
    case EventSource.OPEN:
      return "connected";
    case EventSource.CLOSED:
      return "disconnected";
    default:
      return "unknown";
  }
}
