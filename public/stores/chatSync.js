/**
 * Chat sync service - bridges SSE events with Dexie and Alpine store
 *
 * Flow: SSE Event -> chatSync -> Dexie -> Alpine Store -> UI
 *
 * This module handles:
 * - Processing incoming SSE events
 * - Persisting to IndexedDB via Dexie
 * - Notifying Alpine store of changes
 * - Cross-tab synchronization
 */

import { liveQuery } from "/lib/dexie.mjs";
import {
  getChatDb,
  addMessage,
  updateMessage,
  deleteMessage,
  hydrateChannels,
  hydrateMessages,
  getMessagesForChannel,
  getChannelMessageCount,
  incrementUnread,
  clearUnread,
  setLastSync,
  updateChannel,
  deleteChannel,
  clearAllData,
  deleteOldSharedDatabase,
} from "../db/chatDB.js";

// Store reference (set via init)
let store = null;

// Message processing function (injected from chat.js for decryption)
let processMessage = null;

// User cache for checking mentions
let userCache = null;
let currentUserNpub = null;

// Cross-tab sync subscriptions
let channelSubscription = null;
let messageSubscription = null;

/**
 * Initialize the sync service
 * @param {Object} alpineStore - The Alpine chat store instance
 * @param {Object} options - Configuration options
 */
export async function init(alpineStore, options = {}) {
  store = alpineStore;

  if (options.processMessage) {
    processMessage = options.processMessage;
  }
  if (options.userCache) {
    userCache = options.userCache;
  }
  if (options.currentUserNpub) {
    currentUserNpub = options.currentUserNpub;
  }

  // Clean up old shared database in background (don't block init)
  deleteOldSharedDatabase().catch(err =>
    console.warn("[ChatSync] Failed to delete old shared database:", err)
  );

  // Setup cross-tab sync (now team-scoped via getChatDb())
  setupCrossTabSync();

  console.log("[ChatSync] Initialized");
}

/**
 * Setup cross-tab synchronization using Dexie liveQuery
 * This allows changes from other tabs to be reflected in this tab
 */
function setupCrossTabSync() {
  if (!store) return;

  // Cleanup any existing subscriptions
  cleanupSubscriptions();

  // Subscribe to channel changes (for cross-tab sync only)
  try {
    channelSubscription = liveQuery(() => getChatDb().channels.toArray()).subscribe({
      next: (channels) => {
        if (!store) return;

        // Group by type
        const regular = channels.filter((c) => c.type === "channel");
        const dms = channels.filter((c) => c.type === "dm");
        const personal = channels.find((c) => c.type === "personal");

        // Only update if data has actually changed (compare by serialization)
        // IMPORTANT: Don't overwrite existing store data with empty IndexedDB data
        // This prevents wiping server-loaded channels when the team DB is new/empty
        const currentRegularIds = store.channels.map((c) => c.id).join(",");
        const newRegularIds = regular.map((c) => c.id).join(",");
        if (currentRegularIds !== newRegularIds && (regular.length > 0 || store.channels.length === 0)) {
          console.log("[ChatSync] Cross-tab: channels updated");
          store.channels = regular.map((c) => ({
            ...c,
            id: String(c.id),
          }));
        }

        const currentDmIds = store.dmChannels.map((c) => c.id).join(",");
        const newDmIds = dms.map((c) => c.id).join(",");
        if (currentDmIds !== newDmIds && (dms.length > 0 || store.dmChannels.length === 0)) {
          console.log("[ChatSync] Cross-tab: DM channels updated");
          store.dmChannels = dms.map((c) => ({
            ...c,
            id: String(c.id),
          }));
        }

        if (personal && (!store.personalChannel || store.personalChannel.id !== String(personal.id))) {
          store.personalChannel = { ...personal, id: String(personal.id) };
        }
      },
      error: (err) => {
        console.warn("[ChatSync] Channel subscription error:", err);
      },
    });
  } catch (err) {
    console.warn("[ChatSync] Failed to setup channel subscription:", err);
  }

  // Subscribe to message changes for the current channel
  // This uses a dynamic query based on selectedChannelId
  try {
    let lastChannelId = null;
    let lastMessageCount = 0;

    messageSubscription = liveQuery(() => {
      const channelId = store?.selectedChannelId;
      if (!channelId) return [];
      return getChatDb().messages.where("channelId").equals(channelId).toArray();
    }).subscribe({
      next: (messages) => {
        if (!store || !store.selectedChannelId) return;

        // Check if this is a meaningful update (not just our own write)
        const currentCount = store.messages.length;
        const newCount = messages.length;

        // Only update if message count changed from another tab
        // (our own writes go through handleNewMessage which already updates the store)
        if (
          store.selectedChannelId === lastChannelId &&
          newCount !== lastMessageCount &&
          newCount !== currentCount
        ) {
          console.log(
            "[ChatSync] Cross-tab: messages updated for channel",
            store.selectedChannelId,
            "count:",
            newCount
          );

          // Sort messages
          const sorted = messages.sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );

          store.setMessages(sorted);
        }

        lastChannelId = store.selectedChannelId;
        lastMessageCount = newCount;
      },
      error: (err) => {
        console.warn("[ChatSync] Message subscription error:", err);
      },
    });
  } catch (err) {
    console.warn("[ChatSync] Failed to setup message subscription:", err);
  }

  console.log("[ChatSync] Cross-tab sync enabled");
}

/**
 * Cleanup subscriptions (call on logout or cleanup)
 */
function cleanupSubscriptions() {
  if (channelSubscription) {
    channelSubscription.unsubscribe();
    channelSubscription = null;
  }
  if (messageSubscription) {
    messageSubscription.unsubscribe();
    messageSubscription = null;
  }
}

/**
 * Stop cross-tab sync and cleanup
 */
export function cleanup() {
  cleanupSubscriptions();
  store = null;
  processMessage = null;
  userCache = null;
  currentUserNpub = null;
  console.log("[ChatSync] Cleaned up");
}

/**
 * Set the current user's npub (for mention detection)
 */
export function setCurrentUser(npub) {
  currentUserNpub = npub;
}

/**
 * Set the user cache reference
 */
export function setUserCache(cache) {
  userCache = cache;
}

/**
 * Set the message processing function (for decryption)
 */
export function setMessageProcessor(fn) {
  processMessage = fn;
}

// ========== SSE Event Handlers ==========

/**
 * Handle new message from SSE
 * @param {Object} data - Message data from SSE event
 */
export async function handleNewMessage(data) {
  if (!store) {
    console.warn("[ChatSync] Store not initialized");
    return;
  }

  const channelId = String(data.channelId || data.channel_id);
  const rawMessage = {
    id: String(data.id),
    channelId: channelId,
    author: data.author,
    body: data.body,
    createdAt: data.created_at || data.createdAt,
    parentId: data.parent_id ? String(data.parent_id) : null,
    threadRootId: data.thread_root_id ? String(data.thread_root_id) : null,
    encrypted: data.encrypted || false,
    keyVersion: data.key_version || null,
  };

  // Process message (decrypt if needed)
  let message = rawMessage;
  if (processMessage) {
    try {
      message = await processMessage(rawMessage, channelId);
    } catch (err) {
      console.error("[ChatSync] Failed to process message:", err);
      message.decryptionFailed = true;
    }
  }

  // Save to Dexie
  try {
    await addMessage(message);
  } catch (err) {
    console.error("[ChatSync] Failed to save message to Dexie:", err);
  }

  // Update Alpine store
  if (store.selectedChannelId === channelId) {
    // Currently viewing this channel - add to display
    store.onMessageAdded(message);
  } else {
    // Not viewing - update unread count
    store.incrementUnread(channelId);
    await incrementUnread(channelId);

    // Check for mentions
    if (currentUserNpub && message.body) {
      const isMentioned = message.body.includes(`nostr:${currentUserNpub}`);
      if (isMentioned) {
        store.incrementMention(channelId);
      }
    }
  }

  return { message };
}

/**
 * Handle message deletion from SSE
 * @param {Object} data - { messageId, channelId }
 */
export async function handleMessageDeleted(data) {
  if (!store) return;

  const messageId = String(data.messageId);
  const channelId = String(data.channelId);

  // Remove from Dexie
  try {
    await deleteMessage(messageId);
  } catch (err) {
    console.error("[ChatSync] Failed to delete message from Dexie:", err);
  }

  // Update Alpine store if viewing this channel
  if (store.selectedChannelId === channelId) {
    store.onMessageDeleted(messageId);
  }
}

/**
 * Handle reaction update from SSE
 * @param {Object} data - { messageId, reactions }
 */
export async function handleReaction(data) {
  if (!store) return;

  const messageId = String(data.messageId);

  // Update in Dexie
  try {
    await updateMessage(messageId, { reactions: data.reactions });
  } catch (err) {
    console.error("[ChatSync] Failed to update reactions in Dexie:", err);
  }

  // Update Alpine store
  store.onMessageReaction(messageId, data.reactions);
}

/**
 * Handle new channel from SSE
 * @param {Object} data - Channel data
 */
export async function handleNewChannel(data) {
  if (!store) return;

  const channel = {
    id: String(data.id),
    name: data.name,
    displayName: data.display_name || data.displayName,
    description: data.description,
    isPublic: data.is_public || data.isPublic,
    encrypted: data.encrypted || false,
  };

  // Update channels in store
  const channels = [...store.channels, channel];
  store.updateChannels(channels, "channel");

  // Save to Dexie
  await hydrateChannels([channel], "channel");
}

/**
 * Handle channel update from SSE
 * @param {Object} data - Updated channel data
 */
export async function handleChannelUpdate(data) {
  if (!store) return;

  const channelId = String(data.id);
  const changes = {
    name: data.name,
    displayName: data.display_name || data.displayName,
    description: data.description,
  };

  // Update in store
  const channel = store.getChannelById(channelId);
  if (channel) {
    Object.assign(channel, changes);
  }

  // Update in Dexie
  await updateChannel(channelId, changes);
}

/**
 * Handle channel deletion from SSE
 * @param {Object} data - { channelId }
 */
export async function handleChannelDeleted(data) {
  if (!store) return;

  const channelId = String(data.channelId || data.id);

  // Remove from store
  store.channels = store.channels.filter(function (c) {
    return c.id !== channelId;
  });

  // If currently viewing, switch to first available
  if (store.selectedChannelId === channelId) {
    if (store.channels.length > 0) {
      store.selectChannel(store.channels[0].id);
    } else {
      store.selectedChannelId = null;
      store.messages = [];
    }
  }

  // Remove from Dexie
  await deleteChannel(channelId);
}

/**
 * Handle new DM channel from SSE
 * @param {Object} data - DM channel data
 */
export async function handleNewDM(data) {
  if (!store) return;

  const channel = {
    id: String(data.id),
    name: data.name,
    displayName: data.display_name || data.displayName,
    description: data.description,
    otherNpub: data.other_npub || data.otherNpub,
    encrypted: data.encrypted || true,
  };

  // Update DM channels in store
  const dmChannels = [...store.dmChannels, channel];
  store.updateChannels(dmChannels, "dm");

  // Save to Dexie
  await hydrateChannels([channel], "dm");
}

/**
 * Handle connection state change
 * @param {string} state - "connected" | "disconnected" | "connecting"
 */
export function handleConnectionChange(state) {
  if (!store) return;
  store.setConnectionState(state);
}

// ========== Data Loading ==========

/**
 * Load messages for a channel from server and cache to Dexie
 * @param {string} channelId
 * @param {Array} messages - Messages from server
 */
export async function loadMessages(channelId, messages) {
  if (!store) return;

  const id = String(channelId);

  // Process messages (decrypt if needed)
  let processed = messages;
  if (processMessage) {
    processed = await Promise.all(
      messages.map(async (msg) => {
        try {
          return await processMessage(msg, id);
        } catch (err) {
          console.error("[ChatSync] Failed to process message:", err);
          return { ...msg, decryptionFailed: true };
        }
      })
    );
  }

  // Hydrate Dexie
  await hydrateMessages(id, processed);

  // Update store if this is the selected channel
  if (store.selectedChannelId === id) {
    store.setMessages(processed);
  }

  return processed;
}

/**
 * Load messages from Dexie cache (for offline or fast initial load)
 * @param {string} channelId
 */
export async function loadMessagesFromCache(channelId) {
  if (!store) return [];

  const id = String(channelId);
  const messages = await getMessagesForChannel(id);

  if (store.selectedChannelId === id) {
    store.setMessages(messages);
  }

  return messages;
}

/**
 * Load channels from server and cache to Dexie
 * @param {Array} channels
 * @param {string} type - "channel" | "dm" | "personal"
 */
export async function loadChannels(channels, type = "channel") {
  if (!store) return;

  // Update store
  store.updateChannels(channels, type);

  // Hydrate Dexie
  await hydrateChannels(channels, type);
}

/**
 * Mark a channel as read
 * @param {string} channelId
 */
export async function markAsRead(channelId) {
  if (!store) return;

  const id = String(channelId);
  store.clearUnread(id);
  await clearUnread(id);
}

// ========== Initial Sync ==========

/**
 * Handle initial sync data from SSE connection
 * @param {Object} data - { channels, dmChannels, personalChannel, unreadState }
 */
export async function handleInitialSync(data) {
  if (!store) return;

  console.log("[ChatSync] Processing initial sync...");

  // Update channels
  if (data.channels) {
    await loadChannels(data.channels, "channel");
  }
  if (data.dmChannels) {
    await loadChannels(data.dmChannels, "dm");
  }
  if (data.personalChannel) {
    await loadChannels([data.personalChannel], "personal");
  }

  // Update unread state
  if (data.unreadState) {
    Object.keys(data.unreadState).forEach(function (channelId) {
      const state = data.unreadState[channelId];
      store.unreadCounts[channelId] = state.unread || 0;
      store.mentionCounts[channelId] = state.mentions || 0;
    });
  }

  console.log("[ChatSync] Initial sync complete");
}

// ========== Utility ==========

/**
 * Get the store reference
 */
export function getStore() {
  return store;
}

/**
 * Check if sync service is initialized
 */
export function isInitialized() {
  return store !== null;
}
