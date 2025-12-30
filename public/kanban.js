import { state, setViewMode, refreshUI } from "./state.js";
import { show, hide } from "./dom.js";

let draggedCard = null;

export function initKanban() {
  // Initialize view based on saved preference
  applyViewMode();

  // View switcher click handlers
  const viewSwitcher = document.querySelector("[data-view-switcher]");
  if (viewSwitcher) {
    viewSwitcher.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view-mode]");
      if (!btn) return;
      const mode = btn.dataset.viewMode;
      setViewMode(mode);
      applyViewMode();
    });
  }

  // Initialize drag-drop for kanban cards
  initDragDrop();
}

function applyViewMode() {
  const listView = document.querySelector("[data-list-view]");
  const kanbanView = document.querySelector("[data-kanban-view]");
  const viewBtns = document.querySelectorAll("[data-view-mode]");

  if (state.viewMode === "kanban") {
    hide(listView);
    show(kanbanView);
  } else {
    show(listView);
    hide(kanbanView);
  }

  // Update active button state
  viewBtns.forEach((btn) => {
    if (btn.dataset.viewMode === state.viewMode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
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
    if (column) {
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

    column.classList.remove("drop-target");

    const todoId = draggedCard.dataset.todoId;
    const newState = column.dataset.kanbanCards;
    const oldState = draggedCard.dataset.todoState;

    if (newState === oldState) return;

    // Optimistically move the card
    const emptyMessage = column.querySelector(".kanban-empty");
    if (emptyMessage) emptyMessage.remove();
    column.appendChild(draggedCard);
    draggedCard.dataset.todoState = newState;

    // Update the count badges
    updateColumnCounts();

    // Send update to server
    try {
      const response = await fetch(`/api/todos/${todoId}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: newState }),
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

// Re-export for use in app.js
export { applyViewMode };
