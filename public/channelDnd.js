/**
 * Channel Drag-and-Drop for arrange mode
 *
 * Uses HTML5 Drag and Drop API to let admins reorder channels
 * between sections and reorder sections themselves.
 *
 * Wired up from chat.js when arrange mode is entered.
 */

/**
 * Get the Alpine store from the chat shell
 */
function getStore() {
  const shell = document.querySelector("[data-chat-shell]");
  if (shell && shell._x_dataStack) return shell._x_dataStack[0];
  return null;
}

/**
 * Initialize drag-and-drop listeners on the channel sidebar.
 * Call this when arrange mode is entered; call teardown when exiting.
 */
export function initChannelDnd() {
  const sidebar = document.querySelector(".chat-channels-sidebar");
  if (!sidebar) return;

  sidebar.addEventListener("dragstart", onDragStart);
  sidebar.addEventListener("dragover", onDragOver);
  sidebar.addEventListener("dragenter", onDragEnter);
  sidebar.addEventListener("dragleave", onDragLeave);
  sidebar.addEventListener("drop", onDrop);
  sidebar.addEventListener("dragend", onDragEnd);
}

export function teardownChannelDnd() {
  const sidebar = document.querySelector(".chat-channels-sidebar");
  if (!sidebar) return;

  sidebar.removeEventListener("dragstart", onDragStart);
  sidebar.removeEventListener("dragover", onDragOver);
  sidebar.removeEventListener("dragenter", onDragEnter);
  sidebar.removeEventListener("dragleave", onDragLeave);
  sidebar.removeEventListener("drop", onDrop);
  sidebar.removeEventListener("dragend", onDragEnd);

  // Clean up any leftover indicators
  removeDropIndicator();
  sidebar.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
}

// --- Internal state ---
let dragType = null; // "channel" or "section"
let dragId = null;
let indicatorEl = null; // the drop position line

function onDragStart(e) {
  const channelEl = e.target.closest("[data-drag-channel]");
  const sectionEl = e.target.closest("[data-drag-section]");

  if (channelEl) {
    dragType = "channel";
    dragId = channelEl.dataset.dragChannel;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "channel:" + dragId);
    channelEl.classList.add("dragging");
  } else if (sectionEl && e.target.closest(".section-drag-handle")) {
    dragType = "section";
    dragId = sectionEl.dataset.dragSection;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "section:" + dragId);
    sectionEl.classList.add("dragging");
  } else {
    e.preventDefault();
  }
}

function onDragOver(e) {
  if (!dragType) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  if (dragType === "channel") {
    showDropIndicator(e);
  }
}

function onDragEnter(e) {
  if (!dragType) return;

  if (dragType === "channel") {
    const dropZone = e.target.closest("[data-section-drop]");
    if (dropZone) {
      dropZone.classList.add("drag-over");
    }
  }
}

function onDragLeave(e) {
  if (!dragType) return;

  const dropZone = e.target.closest("[data-section-drop]");
  if (dropZone && !dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove("drag-over");
  }
}

function onDrop(e) {
  e.preventDefault();
  const store = getStore();
  if (!store || !dragType || !dragId) return;

  if (dragType === "channel") {
    handleChannelDrop(e, store);
  } else if (dragType === "section") {
    handleSectionDrop(e, store);
  }

  cleanup();
}

function onDragEnd() {
  cleanup();
}

function cleanup() {
  document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  removeDropIndicator();
  dragType = null;
  dragId = null;
}

// --- Drop indicator ---

function removeDropIndicator() {
  if (indicatorEl) {
    indicatorEl.remove();
    indicatorEl = null;
  }
}

function showDropIndicator(e) {
  const dropZone = e.target.closest("[data-section-drop]");
  if (!dropZone) {
    removeDropIndicator();
    return;
  }

  const channelBtns = Array.from(dropZone.querySelectorAll("[data-drag-channel]"));
  if (channelBtns.length === 0) {
    removeDropIndicator();
    return;
  }

  // Find insertion point
  let insertBefore = null;
  for (const btn of channelBtns) {
    const rect = btn.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      insertBefore = btn;
      break;
    }
  }

  // Create or reuse indicator
  if (!indicatorEl) {
    indicatorEl = document.createElement("div");
    indicatorEl.className = "channel-drop-indicator";
  }

  if (insertBefore) {
    insertBefore.parentNode.insertBefore(indicatorEl, insertBefore);
  } else {
    // After the last channel
    const last = channelBtns[channelBtns.length - 1];
    last.parentNode.insertBefore(indicatorEl, last.nextSibling);
  }
}

// --- Drop handlers ---

function handleChannelDrop(e, store) {
  const dropZone = e.target.closest("[data-section-drop]");
  if (dropZone) {
    const sectionId = dropZone.dataset.sectionDrop;
    const channelBtns = dropZone.querySelectorAll("[data-drag-channel]");
    let position = channelBtns.length;
    for (let i = 0; i < channelBtns.length; i++) {
      const rect = channelBtns[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        position = i;
        break;
      }
    }
    store.moveChannelToSection(dragId, sectionId, position);
  } else {
    // Dropped outside any section -> ungrouped (append)
    store.moveChannelToSection(dragId, "__ungrouped__");
  }
}

function handleSectionDrop(e, store) {
  const allSections = document.querySelectorAll("[data-drag-section]");
  let newIndex = allSections.length;
  for (let i = 0; i < allSections.length; i++) {
    const rect = allSections[i].getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      newIndex = i;
      break;
    }
  }
  store.moveSectionTo(dragId, newIndex);
}
