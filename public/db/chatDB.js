/**
 * Client-side IndexedDB database using Dexie.js for chat
 * This is for local state caching only - server SQLite remains source of truth
 *
 * IMPORTANT: Database is team-scoped to prevent cross-team data leakage.
 * Each team gets its own IndexedDB database: "MarginalGainsChat-{teamSlug}"
 */
import { Dexie } from "/lib/dexie.mjs";
import { getTeamSlug } from "../api.js";

// Cached database instance (per team)
let _chatDb = null;
let _currentTeamSlug = null;

/**
 * Get the team-scoped Dexie database instance.
 * Lazily initializes on first call, and reinitializes if team changes.
 * @returns {Dexie} The Dexie database instance for the current team
 * @throws {Error} If no team context is available
 */
export function getChatDb() {
  const teamSlug = getTeamSlug();

  if (!teamSlug) {
    throw new Error("[ChatDB] No team context - cannot access IndexedDB without team slug");
  }

  // If team changed, close old db and create new one
  if (_chatDb && _currentTeamSlug !== teamSlug) {
    console.log(`[ChatDB] Team changed from "${_currentTeamSlug}" to "${teamSlug}" - switching database`);
    _chatDb.close();
    _chatDb = null;
  }

  if (!_chatDb) {
    const dbName = `MarginalGainsChat-${teamSlug}`;
    console.log(`[ChatDB] Initializing database: ${dbName}`);

    _chatDb = new Dexie(dbName);
    _chatDb.version(1).stores({
      // Channels (regular, DM, personal)
      channels: "id, type, name",

      // Messages with compound index for windowed queries
      messages: "id, channelId, parentId, createdAt, [channelId+createdAt]",

      // Sync queue for offline message sending
      syncQueue: "++id, channelId, action, timestamp",

      // Metadata (lastSync per channel, unread counts)
      meta: "key",
    });

    _currentTeamSlug = teamSlug;
  }

  return _chatDb;
}

/**
 * Delete the old shared database that was used before team isolation.
 * Call this once on app init to clean up stale cross-team data.
 */
export async function deleteOldSharedDatabase() {
  const OLD_DB_NAME = "MarginalGainsChat";
  try {
    // Don't check if exists - just try to delete. Dexie.delete() is safe to call
    // even if the database doesn't exist.
    console.log(`[ChatDB] Attempting to delete old shared database: ${OLD_DB_NAME}`);
    await Dexie.delete(OLD_DB_NAME);
    console.log(`[ChatDB] Old shared database deletion complete`);
  } catch (err) {
    console.warn("[ChatDB] Failed to delete old shared database:", err);
  }
}

// ========== Channel Operations ==========

/**
 * Hydrate channels from server data
 * @param {Array} channels - Array of channel objects
 * @param {string} type - Channel type: "channel", "dm", or "personal"
 */
export async function hydrateChannels(channels, type = "channel") {
  if (!channels || channels.length === 0) return;

  const db = getChatDb();
  await db.transaction("rw", db.channels, async () => {
    // Clear existing channels of this type
    await db.channels.where("type").equals(type).delete();

    // Add new channels
    const toAdd = channels.map((ch) => ({
      ...ch,
      id: String(ch.id),
      type,
    }));
    await db.channels.bulkPut(toAdd);
  });
}

/**
 * Get all channels of a specific type
 * @param {string} type - Channel type
 * @returns {Promise<Array>}
 */
export async function getChannelsByType(type) {
  return getChatDb().channels.where("type").equals(type).toArray();
}

/**
 * Get a single channel by ID
 * @param {string} channelId
 * @returns {Promise<Object|undefined>}
 */
export async function getChannel(channelId) {
  return getChatDb().channels.get(String(channelId));
}

/**
 * Update a channel
 * @param {string} channelId
 * @param {Object} changes
 */
export async function updateChannel(channelId, changes) {
  await getChatDb().channels.update(String(channelId), changes);
}

/**
 * Delete a channel and its messages
 * @param {string} channelId
 */
export async function deleteChannel(channelId) {
  const id = String(channelId);
  const db = getChatDb();
  await db.transaction("rw", [db.channels, db.messages], async () => {
    await db.channels.delete(id);
    await db.messages.where("channelId").equals(id).delete();
  });
}

// ========== Message Operations ==========

/**
 * Hydrate messages for a channel from server data
 * @param {string} channelId
 * @param {Array} messages - Array of message objects
 */
export async function hydrateMessages(channelId, messages) {
  if (!messages || messages.length === 0) return;

  const id = String(channelId);
  const db = getChatDb();

  await db.transaction("rw", [db.messages, db.meta], async () => {
    // Clear existing messages for this channel
    await db.messages.where("channelId").equals(id).delete();

    // Add new messages
    const toAdd = messages.map((msg) => ({
      ...msg,
      id: String(msg.id),
      channelId: id,
      parentId: msg.parentId ? String(msg.parentId) : null,
      createdAt: msg.createdAt || msg.created_at,
    }));
    await db.messages.bulkPut(toAdd);

    // Update last sync time for this channel
    await db.meta.put({ key: `lastSync:${id}`, value: Date.now() });
  });
}

/**
 * Add a single message (from SSE or send)
 * @param {Object} message
 */
export async function addMessage(message) {
  const toAdd = {
    ...message,
    id: String(message.id),
    channelId: String(message.channelId || message.channel_id),
    parentId: message.parentId ? String(message.parentId) : null,
    createdAt: message.createdAt || message.created_at,
  };
  await getChatDb().messages.put(toAdd);
}

/**
 * Update a message (e.g., reactions, edits)
 * @param {string} messageId
 * @param {Object} changes
 */
export async function updateMessage(messageId, changes) {
  await getChatDb().messages.update(String(messageId), changes);
}

/**
 * Delete a message
 * @param {string} messageId
 */
export async function deleteMessage(messageId) {
  await getChatDb().messages.delete(String(messageId));
}

/**
 * Get messages for a channel (all messages, sorted)
 * @param {string} channelId
 * @returns {Promise<Array>}
 */
export async function getMessagesForChannel(channelId) {
  const messages = await getChatDb().messages
    .where("channelId")
    .equals(String(channelId))
    .toArray();

  // Sort by createdAt
  return messages.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * Get a windowed subset of messages for efficient rendering
 * @param {string} channelId
 * @param {number} offset - Start index
 * @param {number} limit - Number of messages
 * @returns {Promise<Array>}
 */
export async function getMessagesWindow(channelId, offset, limit) {
  const messages = await getChatDb().messages
    .where("channelId")
    .equals(String(channelId))
    .toArray();

  // Sort by createdAt
  messages.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Return windowed slice
  return messages.slice(offset, offset + limit);
}

/**
 * Get total message count for a channel
 * @param {string} channelId
 * @returns {Promise<number>}
 */
export async function getChannelMessageCount(channelId) {
  return getChatDb().messages.where("channelId").equals(String(channelId)).count();
}

/**
 * Get thread messages (all replies to a root message)
 * @param {string} parentId - The root message ID
 * @returns {Promise<Array>}
 */
export async function getThreadMessages(parentId) {
  const messages = await getChatDb().messages
    .where("parentId")
    .equals(String(parentId))
    .toArray();

  return messages.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * Get a single message by ID
 * @param {string} messageId
 * @returns {Promise<Object|undefined>}
 */
export async function getMessage(messageId) {
  return getChatDb().messages.get(String(messageId));
}

// ========== Sync Queue Operations ==========

/**
 * Add item to sync queue (for offline message sending)
 * @param {Object} item - { channelId, action, body, parentId, ... }
 */
export async function addToSyncQueue(item) {
  await getChatDb().syncQueue.add({
    ...item,
    timestamp: Date.now(),
  });
}

/**
 * Get all pending sync items
 * @returns {Promise<Array>}
 */
export async function getPendingSyncs() {
  return getChatDb().syncQueue.toArray();
}

/**
 * Remove item from sync queue after successful sync
 * @param {number} id - Sync queue item ID
 */
export async function removeSyncItem(id) {
  await getChatDb().syncQueue.delete(id);
}

// ========== Metadata Operations ==========

/**
 * Get last sync timestamp for a channel
 * @param {string} channelId
 * @returns {Promise<number|null>}
 */
export async function getLastSync(channelId) {
  const meta = await getChatDb().meta.get(`lastSync:${channelId}`);
  return meta?.value ?? null;
}

/**
 * Set last sync timestamp
 * @param {string} channelId
 * @param {number} timestamp
 */
export async function setLastSync(channelId, timestamp = Date.now()) {
  await getChatDb().meta.put({ key: `lastSync:${channelId}`, value: timestamp });
}

/**
 * Get unread count for a channel
 * @param {string} channelId
 * @returns {Promise<number>}
 */
export async function getUnreadCount(channelId) {
  const meta = await getChatDb().meta.get(`unread:${channelId}`);
  return meta?.value ?? 0;
}

/**
 * Set unread count for a channel
 * @param {string} channelId
 * @param {number} count
 */
export async function setUnreadCount(channelId, count) {
  await getChatDb().meta.put({ key: `unread:${channelId}`, value: count });
}

/**
 * Increment unread count
 * @param {string} channelId
 */
export async function incrementUnread(channelId) {
  const current = await getUnreadCount(channelId);
  await setUnreadCount(channelId, current + 1);
}

/**
 * Clear unread count (mark as read)
 * @param {string} channelId
 */
export async function clearUnread(channelId) {
  await setUnreadCount(channelId, 0);
}

// ========== Utility ==========

/**
 * Clear all local chat data (for logout or reset)
 */
export async function clearAllData() {
  const db = getChatDb();
  await db.transaction(
    "rw",
    [db.channels, db.messages, db.syncQueue, db.meta],
    async () => {
      await db.channels.clear();
      await db.messages.clear();
      await db.syncQueue.clear();
      await db.meta.clear();
    }
  );
}

/**
 * Check if database has data for a channel
 * @param {string} channelId
 * @returns {Promise<boolean>}
 */
export async function hasChannelData(channelId) {
  const count = await getChatDb().messages
    .where("channelId")
    .equals(String(channelId))
    .count();
  return count > 0;
}
