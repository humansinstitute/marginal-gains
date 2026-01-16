/**
 * Kanban board utilities
 * Note: Drag-drop is handled by Alpine.js store (kanban-store.js)
 * This file handles: context switcher, thread links, avatar loading
 */

let userCache = null; // Cache users for avatar lookups

export function initKanban() {
  // Add kanban-active class if on kanban view
  const kanbanView = document.querySelector("[data-kanban-view]");
  if (kanbanView) {
    document.body.classList.add("kanban-active");
  }

  // Context switcher (Personal / Group dropdown)
  initContextSwitcher();

  // Thread link handlers
  initThreadLinks();

  // Load avatars - use MutationObserver to handle Alpine-rendered content
  initAvatarObserver();

  // Also do initial load for server-rendered content (list view)
  loadAssigneeAvatars();
}

function initContextSwitcher() {
  const switcher = document.querySelector("[data-context-switcher]");
  if (!switcher) return;

  switcher.addEventListener("change", (e) => {
    const url = e.target.value;
    if (url) {
      window.location.href = url;
    }
  });
}

// Thread links dropdown state
let activeThreadDropdown = null;

function initThreadLinks() {
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
  if (activeThreadDropdown && activeThreadDropdown.dataset.todoId === todoId) {
    closeThreadDropdown();
    return;
  }

  closeThreadDropdown();

  try {
    const res = await fetch(`/api/tasks/${todoId}/threads`);
    if (!res.ok) {
      console.error("Failed to fetch threads");
      return;
    }
    const data = await res.json();
    const threads = data.threads || [];

    if (threads.length === 0) return;

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

// Watch for Alpine-rendered cards and load their avatars
function initAvatarObserver() {
  const kanbanBoard = document.querySelector("[data-kanban-board]");
  if (!kanbanBoard) return;

  const observer = new MutationObserver((mutations) => {
    let hasNewAvatars = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && node.querySelector?.("[data-assignee-npub]")) {
            hasNewAvatars = true;
            break;
          }
        }
      }
      if (hasNewAvatars) break;
    }
    if (hasNewAvatars) {
      loadAssigneeAvatars();
    }
  });

  observer.observe(kanbanBoard, { childList: true, subtree: true });
}

// Load avatars for all assignee elements
async function loadAssigneeAvatars() {
  const assigneeElements = document.querySelectorAll("[data-assignee-npub]");
  if (assigneeElements.length === 0) return;

  // Fetch users from server cache
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

    const avatarUrl = user?.picture || `https://robohash.org/${user?.pubkey || npub}.png?set=set3`;

    img.src = avatarUrl;
    img.hidden = false;
    if (initials) initials.hidden = true;

    const displayName = user?.display_name || user?.name;
    if (displayName) {
      el.title = displayName;
    }
  });
}

// Export for use by Alpine store
export { loadAssigneeAvatars };
