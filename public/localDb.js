/**
 * IndexedDB wrapper for local message/channel storage
 * Provides offline-first storage synced from server via SSE
 */

const DB_NAME = "marginalgains";
const DB_VERSION = 1;

let db = null;

/**
 * Initialize IndexedDB
 */
export async function initLocalDb() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("[LocalDB] Failed to open database:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log("[LocalDB] Database opened successfully");
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Channels store
      if (!database.objectStoreNames.contains("channels")) {
        const channelStore = database.createObjectStore("channels", { keyPath: "id" });
        channelStore.createIndex("type", "type", { unique: false }); // "channel", "dm", "personal"
      }

      // Messages store
      if (!database.objectStoreNames.contains("messages")) {
        const messageStore = database.createObjectStore("messages", { keyPath: "id" });
        messageStore.createIndex("channelId", "channelId", { unique: false });
        messageStore.createIndex("createdAt", "created_at", { unique: false });
        messageStore.createIndex("channelId_createdAt", ["channelId", "created_at"], { unique: false });
      }

      // Sync metadata store (tracks last sync time per channel)
      if (!database.objectStoreNames.contains("syncMeta")) {
        database.createObjectStore("syncMeta", { keyPath: "key" });
      }

      console.log("[LocalDB] Database schema created/upgraded");
    };
  });
}

/**
 * Get a transaction and object store
 */
function getStore(storeName, mode = "readonly") {
  if (!db) throw new Error("Database not initialized");
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ========== Channel Operations ==========

/**
 * Save a channel to local storage
 */
export async function saveChannel(channel, type = "channel") {
  return new Promise((resolve, reject) => {
    const store = getStore("channels", "readwrite");
    const request = store.put({ ...channel, type, id: String(channel.id) });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save multiple channels at once
 */
export async function saveChannels(channels, type = "channel") {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("channels", "readwrite");
    const store = tx.objectStore("channels");

    for (const channel of channels) {
      store.put({ ...channel, type, id: String(channel.id) });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all channels of a specific type
 */
export async function getChannelsByType(type) {
  return new Promise((resolve, reject) => {
    const store = getStore("channels");
    const index = store.index("type");
    const request = index.getAll(type);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a single channel by ID
 */
export async function getChannel(id) {
  return new Promise((resolve, reject) => {
    const store = getStore("channels");
    const request = store.get(String(id));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a channel from local storage
 */
export async function deleteChannel(id) {
  return new Promise((resolve, reject) => {
    const store = getStore("channels", "readwrite");
    const request = store.delete(String(id));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a channel in local storage
 */
export async function updateChannel(id, updates) {
  const existing = await getChannel(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  await saveChannel(updated, existing.type);
  return updated;
}

// ========== Message Operations ==========

/**
 * Save a message to local storage
 */
export async function saveMessage(message) {
  return new Promise((resolve, reject) => {
    const store = getStore("messages", "readwrite");
    // Ensure channelId is stored as string for consistent indexing
    const toSave = {
      ...message,
      id: message.id,
      channelId: String(message.channelId || message.channel_id),
    };
    const request = store.put(toSave);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save multiple messages at once
 */
export async function saveMessages(messages, channelId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");

    for (const message of messages) {
      store.put({
        ...message,
        id: message.id,
        channelId: String(channelId),
      });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all messages for a channel
 */
export async function getMessagesForChannel(channelId) {
  return new Promise((resolve, reject) => {
    const store = getStore("messages");
    const index = store.index("channelId");
    const request = index.getAll(String(channelId));
    request.onsuccess = () => {
      // Sort by created_at
      const messages = request.result || [];
      messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      resolve(messages);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a single message by ID
 */
export async function getMessage(id) {
  return new Promise((resolve, reject) => {
    const store = getStore("messages");
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all messages for a channel
 */
export async function deleteMessagesForChannel(channelId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const index = store.index("channelId");
    const request = index.openCursor(String(channelId));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ========== Sync Metadata ==========

/**
 * Get last sync timestamp for a resource
 */
export async function getLastSync(key) {
  return new Promise((resolve, reject) => {
    const store = getStore("syncMeta");
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result?.timestamp || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Set last sync timestamp for a resource
 */
export async function setLastSync(key, timestamp = Date.now()) {
  return new Promise((resolve, reject) => {
    const store = getStore("syncMeta", "readwrite");
    const request = store.put({ key, timestamp });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ========== Utility ==========

/**
 * Clear all local data (for logout)
 */
export async function clearAllData() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["channels", "messages", "syncMeta"], "readwrite");

    tx.objectStore("channels").clear();
    tx.objectStore("messages").clear();
    tx.objectStore("syncMeta").clear();

    tx.oncomplete = () => {
      console.log("[LocalDB] All data cleared");
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Check if database is initialized
 */
export function isInitialized() {
  return db !== null;
}
