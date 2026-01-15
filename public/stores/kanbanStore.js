/**
 * Alpine.js store for kanban board
 * Manages reactive state and syncs with server via API
 */
import {
  db,
  hydrateFromServer,
  getTodosByState,
  updateTodoLocal,
  addToSyncQueue,
  getPendingSyncs,
  removeSyncItem,
} from "/db/todosDB.js";

// Sync service - handles server communication
const syncService = {
  /**
   * Push state change to server
   * @returns {boolean} Success status
   */
  async pushStateChange(todoId, state, position, groupId) {
    try {
      const body = { state, position };
      if (groupId) body.group_id = groupId;

      const res = await fetch(`/api/todos/${todoId}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Sync failed");

      // Mark as synced in local DB
      await db.todos.update(todoId, { _dirty: false });
      return true;
    } catch (err) {
      console.error("[KanbanStore] Sync error:", err);
      // Queue for retry
      await addToSyncQueue({
        todoId,
        action: "state",
        state,
        position,
        groupId,
      });
      return false;
    }
  },

  /**
   * Retry any queued sync operations
   */
  async retryQueue() {
    const pending = await getPendingSyncs();
    for (const item of pending) {
      if (item.action === "state") {
        const success = await this.pushStateChange(
          item.todoId,
          item.state,
          item.position,
          item.groupId
        );
        if (success) {
          await removeSyncItem(item.id);
        }
      }
    }
  },
};

/**
 * Create Alpine store for kanban board
 * @param {Array} initialTodos - Server-provided initial todos
 * @param {number|null} groupId - Group ID or null for personal
 * @returns {Object} Alpine reactive store
 */
export function createKanbanStore(initialTodos, groupId = null) {
  return {
    // Reactive state - matches TODO_STATES from server
    columns: {
      new: [],
      ready: [],
      in_progress: [],
      review: [],
      done: [],
    },
    groupId: groupId,
    loading: true,
    syncing: false,
    error: null,

    // Drag state
    draggedCard: null,
    draggedFromColumn: null,

    /**
     * Initialize store - called via x-init
     */
    async init() {
      try {
        // Hydrate IndexedDB from server-provided data
        if (initialTodos && initialTodos.length > 0) {
          await hydrateFromServer(initialTodos);
        }

        // Load into reactive state
        await this.refresh();
        this.loading = false;

        // Retry any queued syncs
        syncService.retryQueue();

        // Listen for changes from other tabs
        this.setupCrossTabSync();

        console.log("[KanbanStore] Initialized with", initialTodos?.length || 0, "todos");
      } catch (err) {
        console.error("[KanbanStore] Init error:", err);
        this.error = "Failed to initialize kanban";
        this.loading = false;
      }
    },

    /**
     * Refresh columns from local IndexedDB
     */
    async refresh() {
      const byState = await getTodosByState(this.groupId);
      this.columns.new = byState.new;
      this.columns.ready = byState.ready;
      this.columns.in_progress = byState.in_progress;
      this.columns.review = byState.review;
      this.columns.done = byState.done;
    },

    /**
     * Handle drag start
     */
    onDragStart(event, card, columnName) {
      this.draggedCard = card;
      this.draggedFromColumn = columnName;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.id);
      event.target.classList.add("dragging");
    },

    /**
     * Handle drag end
     */
    onDragEnd(event) {
      event.target.classList.remove("dragging");
      this.draggedCard = null;
      this.draggedFromColumn = null;
      // Remove all drop targets
      document.querySelectorAll(".drop-target").forEach((el) => {
        el.classList.remove("drop-target");
      });
      // Remove placeholder
      document.querySelectorAll(".drop-placeholder").forEach((el) => el.remove());
    },

    /**
     * Handle drag over - show drop indicator
     */
    onDragOver(event, columnName) {
      if (!this.draggedCard) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      const container = event.currentTarget;
      container.classList.add("drop-target");

      // Calculate drop position and show placeholder
      const cards = [...container.querySelectorAll(".kanban-card:not(.dragging)")];
      const afterCard = this.getCardAfterCursor(cards, event.clientY);

      // Create or move placeholder
      let placeholder = container.querySelector(".drop-placeholder");
      if (!placeholder) {
        placeholder = document.createElement("div");
        placeholder.className = "drop-placeholder";
      }

      if (afterCard) {
        container.insertBefore(placeholder, afterCard);
      } else {
        container.appendChild(placeholder);
      }
    },

    /**
     * Handle drag leave
     */
    onDragLeave(event) {
      const container = event.currentTarget;
      if (!container.contains(event.relatedTarget)) {
        container.classList.remove("drop-target");
        const placeholder = container.querySelector(".drop-placeholder");
        if (placeholder) placeholder.remove();
      }
    },

    /**
     * Handle drop - move card to new position
     */
    async onDrop(event, targetColumn) {
      event.preventDefault();
      const container = event.currentTarget;
      container.classList.remove("drop-target");

      if (!this.draggedCard) return;

      const card = this.draggedCard;
      const oldColumn = this.draggedFromColumn;
      const newColumn = targetColumn;

      // Calculate drop position
      const cards = [...container.querySelectorAll(".kanban-card:not(.dragging)")];
      const afterCard = this.getCardAfterCursor(cards, event.clientY);
      const dropIndex = afterCard ? cards.indexOf(afterCard) : cards.length;

      // Calculate position value
      const position = this.calculatePosition(this.columns[newColumn], dropIndex);

      // Remove placeholder
      container.querySelectorAll(".drop-placeholder").forEach((el) => el.remove());

      // Check if this is a no-op
      if (oldColumn === newColumn) {
        const currentIndex = this.columns[oldColumn].findIndex((c) => c.id === card.id);
        const adjustedIndex = currentIndex < dropIndex ? dropIndex - 1 : dropIndex;
        if (currentIndex === adjustedIndex || currentIndex === dropIndex) {
          return;
        }
      }

      // Optimistic UI update
      // Remove from old column
      const oldIndex = this.columns[oldColumn].findIndex((c) => c.id === card.id);
      if (oldIndex > -1) {
        this.columns[oldColumn].splice(oldIndex, 1);
      }

      // Update card state
      card.state = newColumn;
      card.position = position;

      // Insert into new column at correct position
      const adjustedDropIndex = oldColumn === newColumn && oldIndex < dropIndex ? dropIndex - 1 : dropIndex;
      this.columns[newColumn].splice(adjustedDropIndex, 0, card);

      // Update local DB
      await updateTodoLocal(card.id, { state: newColumn, position });

      // Sync to server (non-blocking)
      this.syncing = true;
      await syncService.pushStateChange(card.id, newColumn, position, this.groupId);
      this.syncing = false;

      // Broadcast to other tabs
      if (this._broadcast) this._broadcast();
    },

    /**
     * Find the card that should come after the cursor position
     */
    getCardAfterCursor(cards, y) {
      let closestCard = null;
      let closestOffset = Number.NEGATIVE_INFINITY;

      for (const card of cards) {
        const box = card.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closestOffset) {
          closestOffset = offset;
          closestCard = card;
        }
      }

      return closestCard;
    },

    /**
     * Calculate position value based on surrounding cards
     */
    calculatePosition(column, dropIndex) {
      const BASE = 65536;

      if (column.length === 0) return BASE;

      const positions = column.map((c, i) => (c.position != null ? c.position : (i + 1) * BASE));

      if (dropIndex === 0) {
        return Math.floor(positions[0] / 2);
      }

      if (dropIndex >= column.length) {
        return positions[positions.length - 1] + BASE;
      }

      const prevPos = positions[dropIndex - 1];
      const nextPos = positions[dropIndex];
      return Math.floor((prevPos + nextPos) / 2);
    },

    /**
     * Setup cross-tab synchronization via BroadcastChannel
     */
    setupCrossTabSync() {
      if (!window.BroadcastChannel) return;

      const channel = new BroadcastChannel("kanban-sync");
      channel.onmessage = async (e) => {
        if (e.data.type === "refresh") {
          console.log("[KanbanStore] Cross-tab refresh triggered");
          await this.refresh();
        }
      };

      this._broadcast = () => channel.postMessage({ type: "refresh" });
    },

    /**
     * Get column count for display
     */
    getColumnCount(columnName) {
      return this.columns[columnName]?.length || 0;
    },

    /**
     * Check if a column has no cards
     */
    isColumnEmpty(columnName) {
      return this.columns[columnName]?.length === 0;
    },
  };
}

// Make available globally for Alpine
window.createKanbanStore = createKanbanStore;
