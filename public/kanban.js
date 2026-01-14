import { refreshUI } from "./state.js";

let draggedCard = null;
let userCache = null; // Cache users for avatar lookups

export function initKanban() {
  // Add kanban-active class if on kanban view (detected by presence of kanban-view element)
  const kanbanView = document.querySelector("[data-kanban-view]");
  if (kanbanView) {
    document.body.classList.add("kanban-active");
  }

  // Context switcher (Personal / Group dropdown) - navigates to selected URL
  initContextSwitcher();

  // Initialize drag-drop for kanban cards
  initDragDrop();

  // Initialize thread link handlers
  initThreadLinks();

  // Load avatars for assignees
  loadAssigneeAvatars();
}

function initContextSwitcher() {
  const switcher = document.querySelector("[data-context-switcher]");
  if (!switcher) return;

  // Options now contain full URLs, so just navigate directly
  switcher.addEventListener("change", (e) => {
    const url = e.target.value;
    if (url) {
      window.location.href = url;
    }
  });
}

function initDragDrop() {
  const kanbanBoard = document.querySelector("[data-kanban-board]");
  if (!kanbanBoard) return;

  // Card drag events
  kanbanBoard.addEventListener("dragstart", (e) => {
    const card = e.target.closest("[data-todo-id]");
    if (!card) return;

    // Check if column is readonly
    const column = card.closest("[data-kanban-cards]");
    if (column && column.dataset.readonly === "true") {
      e.preventDefault();
      return;
    }

    draggedCard = card;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.todoId);
  });

  kanbanBoard.addEventListener("dragend", (e) => {
    const card = e.target.closest("[data-todo-id]");
    if (card) card.classList.remove("dragging");
    draggedCard = null;
    // Remove all drop-target highlights
    document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  });

  // Column drop events
  kanbanBoard.addEventListener("dragover", (e) => {
    e.preventDefault();
    const column = e.target.closest("[data-kanban-cards]");
    if (column && column.dataset.readonly !== "true") {
      e.dataTransfer.dropEffect = "move";
      column.classList.add("drop-target");
    }
  });

  kanbanBoard.addEventListener("dragleave", (e) => {
    const column = e.target.closest("[data-kanban-cards]");
    if (column && !column.contains(e.relatedTarget)) {
      column.classList.remove("drop-target");
    }
  });

  kanbanBoard.addEventListener("drop", async (e) => {
    e.preventDefault();
    const column = e.target.closest("[data-kanban-cards]");
    if (!column || !draggedCard) return;

    // Check readonly
    if (column.dataset.readonly === "true") return;

    column.classList.remove("drop-target");

    const todoId = draggedCard.dataset.todoId;
    const newState = column.dataset.kanbanCards;
    const oldState = draggedCard.dataset.todoState;

    if (newState === oldState) return;

    // Get group_id from card or global
    const groupId = draggedCard.dataset.groupId || window.__GROUP_ID__ || null;

    // Optimistically move the card
    const emptyMessage = column.querySelector(".kanban-empty");
    if (emptyMessage) emptyMessage.remove();
    column.appendChild(draggedCard);
    draggedCard.dataset.todoState = newState;

    // Update the count badges
    updateColumnCounts();

    // Send update to server
    try {
      const body = { state: newState };
      if (groupId) body.group_id = groupId;

      const response = await fetch(`/api/todos/${todoId}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error("Failed to update task state");
      }

      // Refresh the page to get updated data
      window.location.reload();
    } catch (err) {
      console.error("Error updating task state:", err);
      // Revert on error - reload page to get correct state
      window.location.reload();
    }
  });
}

function updateColumnCounts() {
  document.querySelectorAll("[data-kanban-column]").forEach((col) => {
    const cards = col.querySelectorAll("[data-todo-id]");
    const countEl = col.querySelector(".kanban-count");
    if (countEl) countEl.textContent = cards.length;

    // Show/hide empty message
    const cardsContainer = col.querySelector("[data-kanban-cards]");
    const emptyMsg = cardsContainer.querySelector(".kanban-empty");
    if (cards.length === 0 && !emptyMsg) {
      cardsContainer.innerHTML = '<p class="kanban-empty">No tasks</p>';
    }
  });
}

// Thread links dropdown state
let activeThreadDropdown = null;

function initThreadLinks() {
  // Use event delegation for thread badge clicks
  document.addEventListener("click", async (e) => {
    const badge = e.target.closest("[data-view-threads]");
    const threadLink = e.target.closest("[data-goto-thread]");

    // Close any open dropdown if clicking outside
    if (!badge && !threadLink && activeThreadDropdown) {
      closeThreadDropdown();
      return;
    }

    // Handle thread badge click - show dropdown
    if (badge) {
      e.preventDefault();
      e.stopPropagation();
      const todoId = badge.dataset.viewThreads;
      await toggleThreadDropdown(badge, todoId);
      return;
    }

    // Handle thread link click - navigate to chat
    if (threadLink) {
      e.preventDefault();
      const channelName = threadLink.dataset.gotoThread;
      const threadId = threadLink.dataset.threadId;
      window.location.href = `/chat/channel/${encodeURIComponent(channelName)}?thread=${threadId}`;
    }
  });
}

async function toggleThreadDropdown(badge, todoId) {
  // Close if clicking the same badge
  if (activeThreadDropdown && activeThreadDropdown.dataset.todoId === todoId) {
    closeThreadDropdown();
    return;
  }

  // Close any existing dropdown
  closeThreadDropdown();

  // Fetch threads for this task
  try {
    const res = await fetch(`/api/tasks/${todoId}/threads`);
    if (!res.ok) {
      console.error("Failed to fetch threads");
      return;
    }
    const data = await res.json();
    const threads = data.threads || [];

    if (threads.length === 0) {
      return;
    }

    // Create dropdown
    const dropdown = document.createElement("div");
    dropdown.className = "thread-links-dropdown";
    dropdown.dataset.todoId = todoId;

    dropdown.innerHTML = threads
      .map((thread) => {
        const preview = thread.body?.slice(0, 50) || "Thread";
        const previewText = thread.body?.length > 50 ? preview + "..." : preview;
        return `<button type="button" class="thread-link-item" data-goto-thread="${escapeHtml(thread.channel_name)}" data-thread-id="${thread.message_id}">
          <span class="thread-link-channel">#${escapeHtml(thread.channel_name)}</span>
          <span class="thread-link-preview">${escapeHtml(previewText)}</span>
        </button>`;
      })
      .join("");

    // Position relative to badge
    const rect = badge.getBoundingClientRect();
    dropdown.style.position = "fixed";
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.zIndex = "1000";

    document.body.appendChild(dropdown);
    activeThreadDropdown = dropdown;
  } catch (_err) {
    console.error("Failed to fetch threads");
  }
}

function closeThreadDropdown() {
  if (activeThreadDropdown) {
    activeThreadDropdown.remove();
    activeThreadDropdown = null;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, (c) => escapes[c]);
}

// Load avatars for all assignee elements from local user cache
async function loadAssigneeAvatars() {
  const assigneeElements = document.querySelectorAll("[data-assignee-npub]");
  if (assigneeElements.length === 0) return;

  // Fetch users from server cache (same source as chat app)
  if (!userCache) {
    try {
      const res = await fetch("/chat/users");
      if (res.ok) {
        const users = await res.json();
        userCache = new Map(users.map((u) => [u.npub, u]));
      }
    } catch (err) {
      console.error("Failed to load user cache:", err);
      return;
    }
  }

  // Update each assignee avatar
  assigneeElements.forEach((el) => {
    const npub = el.dataset.assigneeNpub;
    if (!npub) return;

    const user = userCache?.get(npub);
    const img = el.querySelector("[data-avatar-img]");
    const initials = el.querySelector(".avatar-initials");

    if (!img) return;

    // Get avatar URL from user cache or fall back to RoboHash
    const avatarUrl = user?.picture || `https://robohash.org/${user?.pubkey || npub}.png?set=set3`;

    img.src = avatarUrl;
    img.hidden = false;
    if (initials) initials.hidden = true;

    // Update title with display name if available
    const displayName = user?.display_name || user?.name;
    if (displayName) {
      el.title = displayName;
    }
  });
}

