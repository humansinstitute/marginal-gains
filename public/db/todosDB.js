/**
 * Client-side IndexedDB database using Dexie.js
 * This is for local state caching only - server SQLite remains source of truth
 */
import { Dexie } from "/lib/dexie.mjs";

// Create database instance
export const db = new Dexie("MarginalGains");

// Define schema
db.version(1).stores({
  // Todos table with indexes for efficient queries
  todos: "id, state, position, group_id, assigned_to, [state+position]",
  // Sync queue for offline support
  syncQueue: "++id, todoId, action, timestamp",
  // Metadata (lastSync, etc.)
  meta: "key",
});

/**
 * Hydrate local database from server-provided data
 * Called on initial load to populate IndexedDB
 * @param {Array} todos - Array of todo objects from server
 */
export async function hydrateFromServer(todos) {
  await db.transaction("rw", db.todos, async () => {
    await db.todos.clear();
    if (todos && todos.length > 0) {
      await db.todos.bulkPut(todos);
    }
  });
  await db.meta.put({ key: "lastSync", value: Date.now() });
}

/**
 * Get todos grouped by state for kanban columns
 * @param {number|null} groupId - Filter by group ID (null for personal)
 * @returns {Object} Todos grouped by state
 */
export async function getTodosByState(groupId = null) {
  // Get all todos from local DB (already filtered by server during hydration)
  // Then filter by groupId for display
  const allTodos = await db.todos.toArray();

  let todos;
  if (groupId) {
    todos = allTodos.filter((t) => t.group_id === groupId);
  } else {
    // Personal todos have null or undefined group_id
    todos = allTodos.filter((t) => t.group_id == null);
  }

  // Sort by position (nulls last) then by created_at desc
  todos.sort((a, b) => {
    if (a.position === null && b.position === null) {
      return new Date(b.created_at) - new Date(a.created_at);
    }
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  });

  return {
    new: todos.filter((t) => t.state === "new"),
    ready: todos.filter((t) => t.state === "ready"),
    in_progress: todos.filter((t) => t.state === "in_progress"),
    review: todos.filter((t) => t.state === "review"),
    done: todos.filter((t) => t.state === "done"),
  };
}

/**
 * Get all todos for a specific owner (personal board)
 * @param {string} owner - Owner npub
 * @returns {Array} Todos array
 */
export async function getTodosByOwner(owner) {
  const todos = await db.todos.where("group_id").isNull().toArray();
  return todos.filter((t) => !t.deleted);
}

/**
 * Update a single todo locally (marks as dirty for sync)
 * @param {number} id - Todo ID
 * @param {Object} changes - Fields to update
 */
export async function updateTodoLocal(id, changes) {
  await db.todos.update(id, { ...changes, _dirty: true });
}

/**
 * Get a single todo by ID
 * @param {number} id - Todo ID
 * @returns {Object|undefined} Todo object
 */
export async function getTodoById(id) {
  return db.todos.get(id);
}

/**
 * Add item to sync queue (for offline support)
 * @param {Object} item - Sync queue item
 */
export async function addToSyncQueue(item) {
  await db.syncQueue.add({
    ...item,
    timestamp: Date.now(),
  });
}

/**
 * Get all pending sync items
 * @returns {Array} Pending sync items
 */
export async function getPendingSyncs() {
  return db.syncQueue.toArray();
}

/**
 * Remove item from sync queue after successful sync
 * @param {number} id - Sync queue item ID
 */
export async function removeSyncItem(id) {
  await db.syncQueue.delete(id);
}

/**
 * Get last sync timestamp
 * @returns {number|null} Timestamp or null
 */
export async function getLastSync() {
  const meta = await db.meta.get("lastSync");
  return meta?.value ?? null;
}

/**
 * Clear all local data (useful for logout or reset)
 */
export async function clearLocalData() {
  await db.todos.clear();
  await db.syncQueue.clear();
  await db.meta.clear();
}
