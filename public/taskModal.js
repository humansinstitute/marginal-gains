import { show, hide } from "./dom.js";
import {
  fetchOptikonConfig,
  getNostrSigner,
  createOptikonBoard,
  saveTodoOptikonBoard,
  clearTodoOptikonBoard,
  getGroupOptikonWorkspace,
} from "./optikon.js";

let currentTaskId = null;
let currentTaskOwner = null;
let isCreateMode = false;
let createParentId = null;
let currentOptikonBoardId = null;
let currentOptikonBoardUrl = null;

const el = {
  overlay: null,
  form: null,
  heading: null,
  title: null,
  description: null,
  priority: null,
  state: null,
  scheduled: null,
  board: null,
  groupId: null,
  parentId: null,
  assignee: null, // hidden input for npub
  assigneeLabel: null,
  // Assignee autocomplete elements
  assigneeAutocomplete: null,
  assigneeInput: null,
  assigneeSelected: null,
  assigneeAvatar: null,
  assigneeName: null,
  assigneeClear: null,
  assigneeSuggestions: null,
  tagsWrapper: null,
  tagsHidden: null,
  closeBtn: null,
  cancelBtn: null,
  deleteBtn: null,
  archiveBtn: null,
  linksSection: null,
  linksList: null,
  // Subtask elements
  parentWrapper: null,
  parentTitle: null,
  detachParentBtn: null,
  assignParentBtn: null,
  subtasksSection: null,
  subtasksList: null,
  addSubtaskBtn: null,
  // Parent picker elements
  parentPicker: null,
  parentPickerClose: null,
  parentPickerFilter: null,
  parentPickerList: null,
  // Project picker elements
  projectPickerLabel: null,
  projectPicker: null,
  workingDirectory: null,
  // Optikon elements
  optikonSection: null,
  optikonLink: null,
  optikonLinkUrl: null,
  optikonLinkText: null,
  optikonUnlink: null,
  optikonAttach: null,
  optikonStatus: null,
};

// Cache for group members (keyed by groupId)
let groupMembersCache = {};

export function initTaskModal() {
  el.overlay = document.querySelector("[data-task-modal]");
  el.form = document.querySelector("[data-task-modal-form]");
  el.heading = document.querySelector("[data-task-modal-heading]");
  el.title = document.querySelector("[data-task-modal-title]");
  el.description = document.querySelector("[data-task-modal-description]");
  el.priority = document.querySelector("[data-task-modal-priority]");
  el.state = document.querySelector("[data-task-modal-state]");
  el.scheduled = document.querySelector("[data-task-modal-scheduled]");
  el.board = document.querySelector("[data-task-modal-board]");
  el.groupId = document.querySelector("[data-task-modal-group-id]");
  el.parentId = document.querySelector("[data-task-modal-parent-id]");
  el.assignee = document.querySelector("[data-task-modal-assignee]");
  el.assigneeLabel = document.querySelector("[data-task-modal-assignee-label]");
  // Assignee autocomplete elements
  el.assigneeAutocomplete = document.querySelector("[data-assignee-autocomplete]");
  el.assigneeInput = document.querySelector("[data-assignee-input]");
  el.assigneeSelected = document.querySelector("[data-assignee-selected]");
  el.assigneeAvatar = document.querySelector("[data-assignee-avatar]");
  el.assigneeName = document.querySelector("[data-assignee-name]");
  el.assigneeClear = document.querySelector("[data-assignee-clear]");
  el.assigneeSuggestions = document.querySelector("[data-assignee-suggestions]");
  el.tagsWrapper = document.querySelector("[data-task-modal-tags-wrapper]");
  el.tagsHidden = document.querySelector("[data-task-modal-tags-hidden]");
  el.closeBtn = document.querySelector("[data-task-modal-close]");
  el.cancelBtn = document.querySelector("[data-task-modal-cancel]");
  el.deleteBtn = document.querySelector("[data-task-modal-delete]");
  el.archiveBtn = document.querySelector("[data-task-modal-archive]");
  el.linksSection = document.querySelector("[data-task-modal-links]");
  el.linksList = document.querySelector("[data-task-modal-links-list]");
  // Subtask elements
  el.parentWrapper = document.querySelector("[data-task-modal-parent-wrapper]");
  el.parentTitle = document.querySelector("[data-task-modal-parent-title]");
  el.detachParentBtn = document.querySelector("[data-task-modal-detach-parent]");
  el.assignParentBtn = document.querySelector("[data-task-modal-assign-parent]");
  el.subtasksSection = document.querySelector("[data-task-modal-subtasks]");
  el.subtasksList = document.querySelector("[data-task-modal-subtasks-list]");
  el.addSubtaskBtn = document.querySelector("[data-task-modal-add-subtask]");
  // Parent picker elements
  el.parentPicker = document.querySelector("[data-parent-picker]");
  el.parentPickerClose = document.querySelector("[data-parent-picker-close]");
  el.parentPickerFilter = document.querySelector("[data-parent-picker-filter]");
  el.parentPickerList = document.querySelector("[data-parent-picker-list]");
  // Project picker elements
  el.projectPickerLabel = document.querySelector("[data-project-picker-label]");
  el.projectPicker = document.querySelector("[data-project-picker]");
  el.workingDirectory = document.querySelector("[data-task-modal-working-directory]");
  // Optikon elements
  el.optikonSection = document.querySelector("[data-task-modal-optikon]");
  el.optikonLink = document.querySelector("[data-optikon-link]");
  el.optikonLinkUrl = document.querySelector("[data-optikon-link-url]");
  el.optikonLinkText = document.querySelector("[data-optikon-link-text]");
  el.optikonUnlink = document.querySelector("[data-optikon-unlink]");
  el.optikonAttach = document.querySelector("[data-optikon-attach]");
  el.optikonStatus = document.querySelector("[data-optikon-status]");

  if (!el.overlay) return;

  // Close handlers
  el.closeBtn?.addEventListener("click", closeModal);
  el.cancelBtn?.addEventListener("click", closeModal);
  el.overlay?.addEventListener("click", (e) => {
    if (e.target === el.overlay) closeModal();
  });

  // Delete handler
  el.deleteBtn?.addEventListener("click", handleDelete);

  // Archive handler
  el.archiveBtn?.addEventListener("click", handleArchive);

  // Add subtask handler
  el.addSubtaskBtn?.addEventListener("click", handleAddSubtask);

  // Parent title click handler - opens parent task modal
  el.parentTitle?.addEventListener("click", handleParentClick);

  // Detach from parent handler
  el.detachParentBtn?.addEventListener("click", handleDetachFromParent);

  // Assign parent handler - opens parent picker
  el.assignParentBtn?.addEventListener("click", handleOpenParentPicker);

  // Parent picker handlers
  el.parentPickerClose?.addEventListener("click", closeParentPicker);
  el.parentPickerFilter?.addEventListener("input", handleParentPickerFilter);

  // Project picker handler
  el.projectPicker?.addEventListener("change", handleProjectPickerChange);

  // Optikon handlers
  el.optikonAttach?.addEventListener("click", handleAttachOptikonBoard);
  el.optikonUnlink?.addEventListener("click", handleUnlinkOptikonBoard);

  // Form submit
  el.form?.addEventListener("submit", handleSubmit);

  // Board change handler
  el.board?.addEventListener("change", handleBoardChange);

  // Tag input handling
  initTagInput();

  // Assignee autocomplete handling
  initAssigneeAutocomplete();

  // Make kanban cards clickable
  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-todo-id]");
    if (card && !e.target.closest("button, a, form")) {
      e.preventDefault();
      const todoId = card.dataset.todoId;
      openModalForTask(todoId, card);
    }
  });

  // Make list view items clickable (clicking on summary opens modal instead of expanding)
  document.addEventListener("click", (e) => {
    const summary = e.target.closest(".todo-list summary");
    if (summary && !e.target.closest("button, a, form, .badges")) {
      e.preventDefault();
      const details = summary.closest("details");
      const editForm = details?.querySelector(".edit-form");
      if (editForm) {
        const todoId = editForm.action.match(/\/todos\/(\d+)\/update/)?.[1];
        if (todoId) {
          openModalFromListItem(todoId, details);
        }
      }
    }
  });

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.overlay?.hidden) {
      closeModal();
    }
  });

}

/**
 * Open the modal in create mode
 * @param {Object} options - Optional settings
 * @param {number|null} options.parentId - Parent task ID for creating subtasks
 * @param {string} options.parentTitle - Parent task title (for display)
 * @param {string} options.groupId - Group ID to pre-select
 */
function openModalForCreate(options = {}) {
  isCreateMode = true;
  currentTaskId = null;
  createParentId = options.parentId || null;

  // Update heading
  if (el.heading) {
    el.heading.textContent = createParentId ? "New Subtask" : "New Task";
  }

  // Clear form fields
  if (el.title) el.title.value = "";
  if (el.description) el.description.value = "";
  if (el.priority) el.priority.value = "sand";
  if (el.state) el.state.value = "new";
  if (el.scheduled) el.scheduled.value = "";
  if (el.tagsHidden) el.tagsHidden.value = "";
  if (el.parentId) el.parentId.value = createParentId || "";

  // Set group_id from options or current context
  const currentGroupId = options.groupId || document.querySelector("[data-kanban-board]")?.dataset.groupId || "";
  if (el.board) el.board.value = currentGroupId;
  if (el.groupId) el.groupId.value = currentGroupId;

  // Update assignee visibility and clear selection
  updateAssigneeVisibility(currentGroupId);
  clearAssigneeSelection();

  // Reset project picker
  hideProjectPicker();

  // Clear tag chips
  renderTagChips("");

  // Set form action for create - use team-scoped URL if on team page
  if (el.form) {
    const teamSlug = el.form.dataset.teamSlug;
    el.form.action = teamSlug ? `/t/${teamSlug}/todos` : "/todos";
  }

  // Hide edit-only sections
  if (el.deleteBtn) el.deleteBtn.hidden = true;
  if (el.archiveBtn) el.archiveBtn.hidden = true;
  if (el.linksSection) el.linksSection.hidden = true;
  if (el.subtasksSection) el.subtasksSection.hidden = true;
  if (el.optikonSection) el.optikonSection.hidden = true;

  // Hide parent wrapper (not relevant in create mode unless creating subtask)
  if (el.parentWrapper) el.parentWrapper.hidden = true;
  if (el.parentTitle) el.parentTitle.hidden = true;
  if (el.detachParentBtn) el.detachParentBtn.hidden = true;
  if (el.assignParentBtn) el.assignParentBtn.hidden = true;

  // Show parent info if creating a subtask
  if (createParentId && options.parentTitle) {
    if (el.parentWrapper) el.parentWrapper.hidden = false;
    if (el.parentTitle) {
      el.parentTitle.hidden = false;
      el.parentTitle.textContent = options.parentTitle;
    }
  }

  show(el.overlay);
  el.title?.focus();
}

// Export for external use (e.g., from Add Subtask button, Alpine templates)
window.openTaskModalForCreate = openModalForCreate;
window.openTaskModal = openModalForTaskById;

async function openModalForTask(todoId, card) {
  isCreateMode = false;
  currentTaskId = todoId;
  createParentId = null;

  // Update heading
  if (el.heading) {
    el.heading.textContent = "Edit Task";
  }

  // Show edit-only elements
  if (el.deleteBtn) el.deleteBtn.hidden = false;

  // Reset parent/subtask sections (will be properly set by fetchAndDisplaySubtasks)
  if (el.parentWrapper) el.parentWrapper.hidden = true;
  if (el.subtasksSection) el.subtasksSection.hidden = true;

  // Fetch full task details from server
  const teamSlug = el.form?.dataset.teamSlug;
  const taskUrl = teamSlug
    ? `/t/${teamSlug}/api/todos/${todoId}`
    : `/api/todos/${todoId}`;

  try {
    const res = await fetch(taskUrl);
    if (res.ok) {
      const task = await res.json();
      // Use full task data from server
      populateModal({
        title: task.title || "",
        description: task.description || "",
        priority: task.priority || "sand",
        state: task.state || "ready",
        scheduled_for: task.scheduled_for || "",
        tags: task.tags || "",
        assigned_to: task.assigned_to || "",
        group_id: task.group_id ? String(task.group_id) : "",
        optikon_board_id: task.optikon_board_id || null,
        optikon_board_url: task.optikon_board_url || null,
        working_directory: task.working_directory || null,
      });
    } else {
      // Fallback to card data if fetch fails
      populateModalFromCard(card);
    }
  } catch (err) {
    console.error("[TaskModal] Failed to fetch task details:", err);
    // Fallback to card data if fetch fails
    populateModalFromCard(card);
  }

  show(el.overlay);
  el.title?.focus();

  // Fetch and display task links
  await fetchAndDisplayLinks(todoId);

  // Fetch and display subtasks
  await fetchAndDisplaySubtasks(todoId);
}

function populateModalFromCard(card) {
  // Extract data from the card (fallback for when API fails)
  const title = card.querySelector(".kanban-card-title")?.textContent || "";
  const desc = card.querySelector(".kanban-card-desc")?.textContent || "";

  // Get state - prefer data attribute, but fallback to column if blank/invalid
  const validStates = ["new", "ready", "in_progress", "review", "done", "archived"];
  let state = card.dataset.todoState || "";
  if (!validStates.includes(state)) {
    const column = card.closest("[data-kanban-column]");
    if (column) {
      state = column.dataset.kanbanColumn || "ready";
    } else {
      state = "ready";
    }
  }

  const assigned_to = card.dataset.assignedTo || "";
  const group_id = card.dataset.groupId || "";

  // Get priority from badge
  const badge = card.querySelector(".badge");
  let priority = "sand";
  if (badge?.classList.contains("priority-rock")) priority = "rock";
  else if (badge?.classList.contains("priority-pebble")) priority = "pebble";
  else if (badge?.classList.contains("priority-sand")) priority = "sand";

  // Get tags
  const tagChips = card.querySelectorAll(".kanban-card-meta .tag-chip");
  const tags = Array.from(tagChips).map(chip => chip.textContent.trim()).join(",");

  populateModal({ title, description: desc, priority, state, scheduled_for: "", tags, assigned_to, group_id, optikon_board_id: null, optikon_board_url: null, working_directory: null });
}

async function openModalFromListItem(todoId, details) {
  isCreateMode = false;
  currentTaskId = todoId;
  createParentId = null;

  // Update heading
  if (el.heading) {
    el.heading.textContent = "Edit Task";
  }

  // Show edit-only elements
  if (el.deleteBtn) el.deleteBtn.hidden = false;

  // Reset parent/subtask sections (will be properly set by fetchAndDisplaySubtasks)
  if (el.parentWrapper) el.parentWrapper.hidden = true;
  if (el.subtasksSection) el.subtasksSection.hidden = true;

  // Fetch full task details from server
  const teamSlug = el.form?.dataset.teamSlug;
  const taskUrl = teamSlug
    ? `/t/${teamSlug}/api/todos/${todoId}`
    : `/api/todos/${todoId}`;

  try {
    const res = await fetch(taskUrl);
    if (res.ok) {
      const task = await res.json();
      // Use full task data from server
      populateModal({
        title: task.title || "",
        description: task.description || "",
        priority: task.priority || "sand",
        state: task.state || "ready",
        scheduled_for: task.scheduled_for || "",
        tags: task.tags || "",
        assigned_to: task.assigned_to || "",
        group_id: task.group_id ? String(task.group_id) : "",
        optikon_board_id: task.optikon_board_id || null,
        optikon_board_url: task.optikon_board_url || null,
        working_directory: task.working_directory || null,
      });
    } else {
      // Fallback to DOM data if fetch fails
      populateModalFromListItem(details);
    }
  } catch (err) {
    console.error("[TaskModal] Failed to fetch task details:", err);
    // Fallback to DOM data if fetch fails
    populateModalFromListItem(details);
  }

  show(el.overlay);
  el.title?.focus();

  // Fetch and display task links
  await fetchAndDisplayLinks(todoId);

  // Fetch and display subtasks
  await fetchAndDisplaySubtasks(todoId);
}

function populateModalFromListItem(details) {
  // Extract data from the details element (fallback for when API fails)
  const editForm = details.querySelector(".edit-form");
  if (!editForm) return;

  const title = editForm.querySelector("[name='title']")?.value || "";
  const description = editForm.querySelector("[name='description']")?.value || "";
  const priority = editForm.querySelector("[name='priority']")?.value || "sand";
  const state = editForm.querySelector("[name='state']")?.value || "ready";
  const scheduled_for = editForm.querySelector("[name='scheduled_for']")?.value || "";
  const tags = editForm.querySelector("[name='tags']")?.value || "";
  const assigned_to = editForm.querySelector("[name='assigned_to']")?.value || "";
  const group_id = editForm.querySelector("[name='group_id']")?.value || "";

  populateModal({ title, description, priority, state, scheduled_for, tags, assigned_to, group_id, optikon_board_id: null, optikon_board_url: null, working_directory: null });
}

function populateModal({ title, description, priority, state, scheduled_for, tags, assigned_to, group_id, optikon_board_id, optikon_board_url, working_directory }) {
  if (el.title) el.title.value = title;
  if (el.description) el.description.value = description;
  if (el.priority) el.priority.value = priority;
  if (el.state) el.state.value = state;
  if (el.scheduled) el.scheduled.value = scheduled_for || "";
  if (el.tagsHidden) el.tagsHidden.value = tags || "";

  // Show archive button only for tasks in 'done' state
  if (el.archiveBtn) {
    el.archiveBtn.hidden = state !== "done";
  }

  // Set board selector and hidden group_id
  if (el.board) el.board.value = group_id || "";
  if (el.groupId) el.groupId.value = group_id || "";

  // Update assignee field visibility based on board
  updateAssigneeVisibility(group_id);

  // Set working_directory hidden input before assignee selection triggers project fetch
  if (el.workingDirectory) el.workingDirectory.value = working_directory || "";

  // Set assignee using autocomplete display
  if (group_id && assigned_to) {
    setAssigneeFromNpub(assigned_to, group_id);
  } else {
    clearAssigneeSelection();
  }

  // Update form action - use team-scoped URL if on team page
  if (el.form) {
    const teamSlug = el.form.dataset.teamSlug;
    el.form.action = teamSlug
      ? `/t/${teamSlug}/todos/${currentTaskId}/update`
      : `/todos/${currentTaskId}/update`;
  }

  // Render tag chips
  renderTagChips(tags);

  // Update Optikon UI state
  updateOptikonUI(optikon_board_id, optikon_board_url);
}

function updateOptikonUI(boardId, boardUrl) {
  // Store current Optikon board info
  currentOptikonBoardId = boardId || null;
  currentOptikonBoardUrl = boardUrl || null;

  // Hide Optikon section in create mode
  if (isCreateMode) {
    if (el.optikonSection) el.optikonSection.hidden = true;
    return;
  }

  // Show Optikon section in edit mode
  if (el.optikonSection) el.optikonSection.hidden = false;

  // Reset status message
  if (el.optikonStatus) {
    el.optikonStatus.hidden = true;
    el.optikonStatus.textContent = "";
  }

  if (boardId && boardUrl) {
    // Has a linked board - show link, hide attach button
    if (el.optikonLink) el.optikonLink.hidden = false;
    if (el.optikonLinkUrl) {
      el.optikonLinkUrl.href = boardUrl;
    }
    if (el.optikonLinkText) {
      el.optikonLinkText.textContent = "Open in Optikon";
    }
    if (el.optikonAttach) el.optikonAttach.hidden = true;
  } else {
    // No linked board - hide link, show attach button
    if (el.optikonLink) el.optikonLink.hidden = true;
    if (el.optikonAttach) el.optikonAttach.hidden = false;
  }
}

async function handleAttachOptikonBoard() {
  if (!currentTaskId) return;

  const teamSlug = el.form?.dataset.teamSlug;
  if (!teamSlug) {
    showOptikonStatus("Optikon is only available for team tasks", true);
    return;
  }

  // Show loading state
  if (el.optikonAttach) {
    el.optikonAttach.disabled = true;
    el.optikonAttach.textContent = "Creating board...";
  }
  showOptikonStatus("Creating Optikon board...", false);

  try {
    // Get Nostr signer for NIP-98 auth
    const signer = await getNostrSigner();
    if (!signer) {
      showOptikonStatus("No Nostr signer available. Please sign in with a Nostr extension or ephemeral key.", true);
      resetOptikonAttachButton();
      return;
    }

    // Fetch Optikon config from server
    const config = await fetchOptikonConfig(teamSlug);
    if (!config || !config.optikonUrl) {
      showOptikonStatus("Failed to fetch Optikon configuration", true);
      resetOptikonAttachButton();
      return;
    }

    // Get task details for board creation
    const taskTitle = el.title?.value || "Untitled Task";
    const taskDescription = el.description?.value || "";

    // Get group's default workspace (if set)
    const groupId = el.groupId?.value;
    let workspaceId = null;
    if (groupId) {
      workspaceId = await getGroupOptikonWorkspace(teamSlug, Number(groupId));
    }

    // Build task URL for linking back from Optikon
    const taskUrl = `${window.location.origin}/t/${teamSlug}/tasks?task=${currentTaskId}`;

    // Create board via Optikon API (client-side NIP-98 signing)
    const result = await createOptikonBoard({
      title: taskTitle,
      description: taskDescription,
      workspaceId,
      optikonUrl: config.optikonUrl,
      nostrSigner: signer,
      taskUrl,
    });

    if (!result) {
      showOptikonStatus("Failed to create Optikon board", true);
      resetOptikonAttachButton();
      return;
    }

    // Save board link to task via MG backend
    const saved = await saveTodoOptikonBoard(teamSlug, Number(currentTaskId), result.boardId, result.boardUrl);
    if (!saved) {
      showOptikonStatus("Board created but failed to save link to task", true);
      resetOptikonAttachButton();
      return;
    }

    // Update UI to show the board link
    updateOptikonUI(result.boardId, result.boardUrl);
    showOptikonStatus("Board created successfully!", false);

    // Update kanban store if available
    const store = window.__kanbanStore;
    if (store) {
      const task = findTaskInStore(store, Number(currentTaskId));
      if (task) {
        task.optikon_board_id = result.boardId;
        task.optikon_board_url = result.boardUrl;
      }
    }
  } catch (err) {
    console.error("[TaskModal] Error attaching Optikon board:", err);
    showOptikonStatus(`Error: ${err.message || "Failed to create board"}`, true);
    resetOptikonAttachButton();
  }
}

async function handleUnlinkOptikonBoard() {
  if (!currentTaskId) return;

  const teamSlug = el.form?.dataset.teamSlug;
  if (!teamSlug) return;

  if (!confirm("Remove the Optikon board link from this task? The board will still exist in Optikon.")) {
    return;
  }

  showOptikonStatus("Removing board link...", false);

  try {
    const cleared = await clearTodoOptikonBoard(teamSlug, Number(currentTaskId));
    if (!cleared) {
      showOptikonStatus("Failed to remove board link", true);
      return;
    }

    // Update UI to show attach button
    updateOptikonUI(null, null);
    showOptikonStatus("Board link removed", false);

    // Update kanban store if available
    const store = window.__kanbanStore;
    if (store) {
      const task = findTaskInStore(store, Number(currentTaskId));
      if (task) {
        task.optikon_board_id = null;
        task.optikon_board_url = null;
      }
    }
  } catch (err) {
    console.error("[TaskModal] Error unlinking Optikon board:", err);
    showOptikonStatus(`Error: ${err.message || "Failed to remove link"}`, true);
  }
}

function showOptikonStatus(message, isError) {
  if (!el.optikonStatus) return;
  el.optikonStatus.textContent = message;
  el.optikonStatus.hidden = false;
  el.optikonStatus.classList.toggle("error", isError);

  // Auto-hide success messages after a delay
  if (!isError) {
    setTimeout(() => {
      if (el.optikonStatus?.textContent === message) {
        el.optikonStatus.hidden = true;
      }
    }, 3000);
  }
}

function resetOptikonAttachButton() {
  if (el.optikonAttach) {
    el.optikonAttach.disabled = false;
    el.optikonAttach.innerHTML = '<span class="optikon-icon">&#127919;</span> Attach Optikon Board';
  }
}

function findTaskInStore(store, taskId) {
  if (!store || !store.columns) return null;
  for (const column of Object.values(store.columns)) {
    const task = column.find((t) => t.id === taskId);
    if (task) return task;
  }
  return null;
}

function renderTagChips(tags) {
  if (!el.tagsWrapper) return;

  // Clear existing chips
  el.tagsWrapper.querySelectorAll(".tag-chip").forEach(chip => chip.remove());

  // Add new chips
  const tagList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [];
  const input = el.tagsWrapper.querySelector("input[type='text']");

  tagList.forEach(tag => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.dataset.tag = tag;
    chip.innerHTML = `${escapeHtml(tag)}<span class="remove-tag">&times;</span>`;
    chip.querySelector(".remove-tag")?.addEventListener("click", () => {
      chip.remove();
      syncTagsHidden();
    });
    el.tagsWrapper.insertBefore(chip, input);
  });
}

function initTagInput() {
  const input = el.tagsWrapper?.querySelector("input[type='text']");
  if (!input) return;

  input.addEventListener("keydown", (e) => {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      const value = input.value.trim().replace(/,/g, "");
      if (value) {
        addTag(value);
        input.value = "";
      }
    } else if (e.key === "Backspace" && !input.value) {
      // Remove last tag
      const chips = el.tagsWrapper.querySelectorAll(".tag-chip");
      if (chips.length > 0) {
        chips[chips.length - 1].remove();
        syncTagsHidden();
      }
    }
  });

  input.addEventListener("blur", () => {
    const value = input.value.trim().replace(/,/g, "");
    if (value) {
      addTag(value);
      input.value = "";
    }
  });
}

function addTag(tag) {
  if (!el.tagsWrapper) return;

  const input = el.tagsWrapper.querySelector("input[type='text']");
  const chip = document.createElement("span");
  chip.className = "tag-chip";
  chip.dataset.tag = tag;
  chip.innerHTML = `${escapeHtml(tag)}<span class="remove-tag">&times;</span>`;
  chip.querySelector(".remove-tag")?.addEventListener("click", () => {
    chip.remove();
    syncTagsHidden();
  });
  el.tagsWrapper.insertBefore(chip, input);
  syncTagsHidden();
}

function syncTagsHidden() {
  if (!el.tagsWrapper || !el.tagsHidden) return;
  const chips = el.tagsWrapper.querySelectorAll(".tag-chip");
  const tags = Array.from(chips).map(chip => chip.dataset.tag).join(",");
  el.tagsHidden.value = tags;
}

function closeModal() {
  hide(el.overlay);
  currentTaskId = null;
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!el.form) return;

  // In edit mode, require a task ID
  if (!isCreateMode && !currentTaskId) return;

  // Sync tags before submit
  syncTagsHidden();

  // Debug: log form details before submit
  console.log('[TaskModal] Submitting form:', {
    action: el.form.action,
    method: el.form.method,
    isCreateMode,
    parentId: el.parentId?.value,
    groupId: el.groupId?.value,
    title: el.title?.value
  });

  // When creating a subtask, use fetch so we can return to parent modal
  if (isCreateMode && createParentId) {
    const store = window.__kanbanStore;
    const teamSlug = el.form?.dataset.teamSlug;
    const subtaskUrl = teamSlug
      ? `/t/${teamSlug}/api/todos/${createParentId}/subtasks`
      : `/api/todos/${createParentId}/subtasks`;

    try {
      const res = await fetch(subtaskUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: el.title?.value }),
      });

      if (res.ok) {
        const data = await res.json();
        const parentId = createParentId;

        // Add subtask to kanban store if available
        if (store && data.subtask) {
          store.columns['new'].unshift(data.subtask);
          // Update parent progress
          store.buildRelationships();
        }

        closeModal();
        // Return to parent task modal for quick subtask creation
        setTimeout(() => {
          openModalForTaskById(String(parentId));
        }, 100);
        return;
      }

      // Handle errors
      const errorData = await res.json().catch(() => ({}));
      console.error("[TaskModal] Failed to create subtask:", errorData);
      alert(errorData.error || "Failed to create subtask. Please try again.");
    } catch (err) {
      console.error("[TaskModal] Error creating subtask:", err);
      alert("Failed to create subtask. Please try again.");
    }
    return;
  }

  // Edit mode: use kanban store for live update if available
  if (!isCreateMode && currentTaskId) {
    const store = window.__kanbanStore;
    if (store) {
      const fields = {
        title: el.title?.value || "",
        description: el.description?.value || "",
        priority: el.priority?.value || "sand",
        state: el.state?.value || "new",
        scheduled_for: el.scheduled?.value || null,
        tags: el.tagsHidden?.value || "",
        assigned_to: el.assignee?.value || null,
        working_directory: el.workingDirectory?.value || null,
      };

      const success = await store.updateTask(Number(currentTaskId), fields);
      if (success) {
        closeModal();
        return;
      }
      // Fall through to legacy behavior if store update fails
    }
  }

  // Legacy: Submit the form normally (will redirect)
  el.form.submit();
}

async function handleDelete() {
  if (!currentTaskId) return;

  // Check if this task has subtasks - use team-scoped URL if on team page
  const teamSlug = el.form?.dataset.teamSlug;
  const subtasksUrl = teamSlug
    ? `/t/${teamSlug}/api/todos/${currentTaskId}/subtasks`
    : `/api/todos/${currentTaskId}/subtasks`;

  try {
    const res = await fetch(subtasksUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.subtasks && data.subtasks.length > 0) {
        const message = `This task has ${data.subtasks.length} subtask(s).\n\n` +
          `Deleting it will convert them to regular tasks.\n\n` +
          `Are you sure you want to delete this parent task?`;
        if (!confirm(message)) return;
      } else {
        if (!confirm("Are you sure you want to delete this task?")) return;
      }
    } else {
      if (!confirm("Are you sure you want to delete this task?")) return;
    }
  } catch (err) {
    // Fallback to simple confirm if API fails
    if (!confirm("Are you sure you want to delete this task?")) return;
  }

  // Use kanban store for live update if available
  const store = window.__kanbanStore;
  if (store) {
    const success = await store.removeTask(Number(currentTaskId));
    if (success) {
      closeModal();
      return;
    }
    // Fall through to legacy behavior if store update fails
  }

  // Legacy: Create and submit a delete form
  const deleteUrl = teamSlug
    ? `/t/${teamSlug}/todos/${currentTaskId}/delete`
    : `/todos/${currentTaskId}/delete`;

  const form = document.createElement("form");
  form.method = "POST";
  form.action = deleteUrl;

  // Include group_id so server knows where to redirect back to
  if (el.groupId?.value) {
    const groupInput = document.createElement("input");
    groupInput.type = "hidden";
    groupInput.name = "group_id";
    groupInput.value = el.groupId.value;
    form.appendChild(groupInput);
  }

  document.body.appendChild(form);
  form.submit();
}

async function handleArchive() {
  if (!currentTaskId) return;

  if (!confirm("Are you sure you want to archive this task?")) return;

  // Use kanban store for live update if available
  const store = window.__kanbanStore;
  if (store) {
    const success = await store.moveTask(Number(currentTaskId), "archived");
    if (success) {
      closeModal();
      return;
    }
    // Fall through to legacy behavior if store update fails
  }

  // Legacy: Archive by transitioning to 'archived' state via API
  const teamSlug = el.form?.dataset.teamSlug;
  const stateUrl = teamSlug
    ? `/t/${teamSlug}/api/todos/${currentTaskId}/state`
    : `/api/todos/${currentTaskId}/state`;

  try {
    const res = await fetch(stateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "archived" }),
    });

    if (res.ok) {
      // Reload page to reflect the change (fallback when no store)
      window.location.reload();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to archive task");
    }
  } catch (err) {
    console.error("Error archiving task:", err);
    alert("Failed to archive task");
  }
}

function handleBoardChange() {
  const newGroupId = el.board?.value || "";

  // Update hidden group_id field
  if (el.groupId) el.groupId.value = newGroupId;

  // Update assignee visibility
  updateAssigneeVisibility(newGroupId);

  // Clear assignee when changing boards (will be handled by backend based on rules)
  if (el.assignee) el.assignee.value = "";

  // Fetch group members if switching to a group
  if (newGroupId) {
    fetchGroupMembers(newGroupId);
  }
}

function updateAssigneeVisibility(groupId) {
  if (!el.assigneeLabel) return;

  if (groupId) {
    // Show assignee field for group boards
    el.assigneeLabel.hidden = false;
  } else {
    // Hide assignee field for personal board (auto-assigns to owner)
    el.assigneeLabel.hidden = true;
    // Clear assignee when switching to personal board
    clearAssigneeSelection();
  }
}

async function fetchGroupMembers(groupId) {
  if (!groupId) return [];

  // Check cache first
  if (groupMembersCache[groupId]) {
    return groupMembersCache[groupId];
  }

  try {
    // Use team-scoped URL if on team page
    const teamSlug = el.form?.dataset.teamSlug;
    const membersUrl = teamSlug
      ? `/t/${teamSlug}/groups/${groupId}/members`
      : `/chat/groups/${groupId}/members`;
    const res = await fetch(membersUrl);
    if (!res.ok) return [];

    const data = await res.json();
    const members = data.members || [];

    // Cache the result
    groupMembersCache[groupId] = members;
    return members;
  } catch (err) {
    console.error("Failed to fetch group members:", err);
    return [];
  }
}

function initAssigneeAutocomplete() {
  if (!el.assigneeInput) return;

  // Show suggestions on focus
  el.assigneeInput.addEventListener("focus", async () => {
    const groupId = el.groupId?.value;
    if (!groupId) return;

    const members = await fetchGroupMembers(groupId);
    showAssigneeSuggestions(members, "");
  });

  // Filter suggestions on input
  el.assigneeInput.addEventListener("input", async () => {
    const groupId = el.groupId?.value;
    if (!groupId) return;

    const members = await fetchGroupMembers(groupId);
    const query = el.assigneeInput.value.toLowerCase();
    showAssigneeSuggestions(members, query);
  });

  // Hide suggestions on blur (with delay for click handling)
  el.assigneeInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (el.assigneeSuggestions) el.assigneeSuggestions.hidden = true;
    }, 200);
  });

  // Clear button handler
  el.assigneeClear?.addEventListener("click", () => {
    clearAssigneeSelection();
  });

  // Handle keyboard navigation
  el.assigneeInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (el.assigneeSuggestions) el.assigneeSuggestions.hidden = true;
      el.assigneeInput.blur();
    }
  });
}

function showAssigneeSuggestions(members, query) {
  if (!el.assigneeSuggestions) return;

  // Filter members by query
  const filtered = members.filter(m => {
    const name = (m.display_name || m.npub).toLowerCase();
    return name.includes(query);
  });

  if (filtered.length === 0) {
    el.assigneeSuggestions.innerHTML = `<div class="assignee-no-results">No matching members</div>`;
    el.assigneeSuggestions.hidden = false;
    return;
  }

  el.assigneeSuggestions.innerHTML = filtered.map(m => {
    const displayName = m.display_name || m.npub.slice(0, 12) + "...";
    const avatarUrl = m.picture || `https://robohash.org/${m.npub}.png?set=set3`;
    return `
      <div class="assignee-suggestion" data-npub="${escapeHtml(m.npub)}" data-name="${escapeHtml(displayName)}" data-picture="${escapeHtml(avatarUrl)}">
        <img class="assignee-suggestion-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
        <span class="assignee-suggestion-name">${escapeHtml(displayName)}</span>
      </div>
    `;
  }).join("");

  // Add click handlers
  el.assigneeSuggestions.querySelectorAll(".assignee-suggestion").forEach(item => {
    item.addEventListener("mousedown", (e) => {
      e.preventDefault(); // Prevent blur from firing first
      selectAssignee(item.dataset.npub, item.dataset.name, item.dataset.picture);
    });
  });

  el.assigneeSuggestions.hidden = false;
}

function selectAssignee(npub, displayName, avatarUrl) {
  // Set hidden input value
  if (el.assignee) el.assignee.value = npub;

  // Show selected display
  if (el.assigneeSelected) el.assigneeSelected.hidden = false;
  if (el.assigneeAvatar) el.assigneeAvatar.src = avatarUrl;
  if (el.assigneeName) el.assigneeName.textContent = displayName;

  // Hide input and suggestions
  if (el.assigneeInput) {
    el.assigneeInput.value = "";
    el.assigneeInput.hidden = true;
  }
  if (el.assigneeSuggestions) el.assigneeSuggestions.hidden = true;

  // Fetch Wingman projects for this assignee
  fetchAndShowProjects(npub);
}

function clearAssigneeSelection() {
  // Clear hidden input
  if (el.assignee) el.assignee.value = "";

  // Hide selected display
  if (el.assigneeSelected) el.assigneeSelected.hidden = true;

  // Show input
  if (el.assigneeInput) {
    el.assigneeInput.value = "";
    el.assigneeInput.hidden = false;
  }

  // Hide and reset project picker
  hideProjectPicker();
}

async function setAssigneeFromNpub(npub, groupId) {
  if (!npub) {
    clearAssigneeSelection();
    return;
  }

  // Fetch members to find the profile data
  const members = await fetchGroupMembers(groupId);
  const member = members.find(m => m.npub === npub);

  if (member) {
    const displayName = member.display_name || member.npub.slice(0, 12) + "...";
    const avatarUrl = member.picture || `https://robohash.org/${member.npub}.png?set=set3`;
    selectAssignee(member.npub, displayName, avatarUrl);
  } else {
    // Member not found in group - just show npub
    const avatarUrl = `https://robohash.org/${npub}.png?set=set3`;
    selectAssignee(npub, npub.slice(0, 12) + "...", avatarUrl);
  }
}

async function fetchAndDisplayLinks(todoId) {
  if (!el.linksSection || !el.linksList) return;

  // Clear previous links
  el.linksList.innerHTML = "";

  try {
    const res = await fetch(`/api/tasks/${todoId}/all-links`);
    if (!res.ok) {
      el.linksSection.hidden = true;
      return;
    }

    const data = await res.json();
    const crmLinks = data.crm_links || [];
    const threadLinks = data.thread_links || [];

    if (crmLinks.length === 0 && threadLinks.length === 0) {
      el.linksSection.hidden = true;
      return;
    }

    el.linksSection.hidden = false;

    // Render CRM links
    crmLinks.forEach(link => {
      const linkItem = createCrmLinkItem(link);
      el.linksList.appendChild(linkItem);
    });

    // Render thread links
    threadLinks.forEach(link => {
      const linkItem = createThreadLinkItem(link);
      el.linksList.appendChild(linkItem);
    });
  } catch (err) {
    console.error("Failed to fetch task links:", err);
    el.linksSection.hidden = true;
  }
}

function createCrmLinkItem(link) {
  const item = document.createElement("div");
  item.className = "task-modal-link-item";

  // Determine entity type and name
  let entityType = "";
  let entityName = "";
  let entityUrl = "";

  if (link.contact_id && link.contact_name) {
    entityType = "Contact";
    entityName = link.contact_name;
    entityUrl = `/crm?view=contact&id=${link.contact_id}`;
  } else if (link.company_id && link.company_name) {
    entityType = "Company";
    entityName = link.company_name;
    entityUrl = `/crm?view=company&id=${link.company_id}`;
  } else if (link.activity_id) {
    entityType = "Activity";
    entityName = link.activity_subject || link.activity_type || "Activity";
    entityUrl = `/crm?view=activities`;
  } else if (link.opportunity_id && link.opportunity_title) {
    entityType = "Opportunity";
    entityName = link.opportunity_title;
    entityUrl = `/crm?view=opportunity&id=${link.opportunity_id}`;
  }

  item.innerHTML = `
    <span class="task-modal-link-type">${escapeHtml(entityType)}</span>
    <a href="${entityUrl}" target="_blank" class="task-modal-link-name">${escapeHtml(entityName)}</a>
    <button type="button" class="task-modal-link-unlink" data-crm-link-id="${link.id}" title="Remove link">&times;</button>
  `;

  // Add unlink handler
  item.querySelector(".task-modal-link-unlink")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await unlinkCrmFromTask(link.id);
  });

  return item;
}

function createThreadLinkItem(link) {
  const item = document.createElement("div");
  item.className = "task-modal-link-item";

  // Get channel info for the link
  const channelName = link.channel_name || "";
  const messagePreview = link.body ? link.body.slice(0, 50) + (link.body.length > 50 ? "..." : "") : "Chat thread";
  const channelUrl = channelName ? `/chat/channel/${channelName}#message-${link.message_id}` : `/chat`;

  item.innerHTML = `
    <span class="task-modal-link-type">Thread</span>
    <a href="${channelUrl}" target="_blank" class="task-modal-link-name">${escapeHtml(messagePreview)}</a>
    <button type="button" class="task-modal-link-unlink" data-thread-message-id="${link.message_id}" title="Remove link">&times;</button>
  `;

  // Add unlink handler
  item.querySelector(".task-modal-link-unlink")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await unlinkThreadFromTask(link.message_id);
  });

  return item;
}

async function unlinkCrmFromTask(linkId) {
  if (!currentTaskId) return;

  try {
    const res = await fetch(`/api/tasks/${currentTaskId}/crm-links/${linkId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      // Refresh links display
      await fetchAndDisplayLinks(currentTaskId);
    } else {
      console.error("Failed to unlink CRM entity");
    }
  } catch (err) {
    console.error("Error unlinking CRM entity:", err);
  }
}

async function unlinkThreadFromTask(messageId) {
  if (!currentTaskId) return;

  try {
    // Team version uses different path structure: /t/{slug}/api/tasks/{id}/unlink/{messageId}
    const teamSlug = el.form?.dataset.teamSlug;
    const unlinkUrl = teamSlug
      ? `/t/${teamSlug}/api/tasks/${currentTaskId}/unlink/${messageId}`
      : `/api/tasks/${currentTaskId}/threads/${messageId}`;
    const res = await fetch(unlinkUrl, {
      method: "DELETE",
    });

    if (res.ok) {
      // Refresh links display
      await fetchAndDisplayLinks(currentTaskId);
    } else {
      console.error("Failed to unlink thread");
    }
  } catch (err) {
    console.error("Error unlinking thread:", err);
  }
}

function escapeHtml(str) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, (c) => escapes[c]);
}

// ==================== Project Picker Functions ====================

// Cache for wingman projects (keyed by npub)
let wingmanProjectsCache = {};

async function fetchAndShowProjects(npub) {
  if (!npub) {
    hideProjectPicker();
    return;
  }

  // Show the picker label while loading
  if (el.projectPickerLabel) el.projectPickerLabel.hidden = false;

  // Check cache
  if (wingmanProjectsCache[npub]) {
    populateProjectPicker(wingmanProjectsCache[npub]);
    return;
  }

  try {
    const teamSlug = el.form?.dataset.teamSlug;
    if (!teamSlug) {
      hideProjectPicker();
      return;
    }

    const res = await fetch(`/t/${teamSlug}/api/wingman/projects?npub=${encodeURIComponent(npub)}`);
    if (!res.ok) {
      console.warn("[TaskModal] Failed to fetch wingman projects:", res.status);
      hideProjectPicker();
      return;
    }

    const data = await res.json();
    const projects = data.projects || [];

    // Cache the result
    wingmanProjectsCache[npub] = projects;
    populateProjectPicker(projects);
  } catch (err) {
    console.error("[TaskModal] Error fetching wingman projects:", err);
    hideProjectPicker();
  }
}

function populateProjectPicker(projects) {
  if (!el.projectPicker) return;

  // Clear existing options
  el.projectPicker.innerHTML = '<option value="">No project</option>';

  if (projects.length === 0) {
    hideProjectPicker();
    return;
  }

  // Add project options
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.directoryPath;
    option.textContent = project.name || project.directoryPath;
    el.projectPicker.appendChild(option);
  }

  // If we have a previously saved working_directory, pre-select it
  const savedDir = el.workingDirectory?.value;
  if (savedDir) {
    el.projectPicker.value = savedDir;
  }

  if (el.projectPickerLabel) el.projectPickerLabel.hidden = false;
}

function hideProjectPicker() {
  if (el.projectPickerLabel) el.projectPickerLabel.hidden = true;
  if (el.projectPicker) el.projectPicker.value = "";
  if (el.workingDirectory) el.workingDirectory.value = "";
}

function handleProjectPickerChange() {
  const selectedPath = el.projectPicker?.value || "";
  if (el.workingDirectory) el.workingDirectory.value = selectedPath;
}

// ==================== Subtask Functions ====================

async function fetchAndDisplaySubtasks(todoId) {
  // Hide all sections initially
  if (el.parentWrapper) el.parentWrapper.hidden = true;
  if (el.subtasksSection) el.subtasksSection.hidden = true;

  // Helper to set parent wrapper state
  function setParentState(mode, parentData = null) {
    // mode: 'has-parent', 'no-parent', or 'hidden'
    if (mode === 'hidden') {
      if (el.parentWrapper) el.parentWrapper.hidden = true;
      return;
    }

    if (el.parentWrapper) el.parentWrapper.hidden = false;

    if (mode === 'has-parent' && parentData) {
      if (el.parentTitle) {
        el.parentTitle.hidden = false;
        el.parentTitle.textContent = parentData.title;
      }
      if (el.detachParentBtn) el.detachParentBtn.hidden = false;
      if (el.assignParentBtn) el.assignParentBtn.hidden = true;
      // Store parent ID for navigation
      if (el.parentWrapper) el.parentWrapper.dataset.parentId = parentData.id;
    } else if (mode === 'no-parent') {
      if (el.parentTitle) el.parentTitle.hidden = true;
      if (el.detachParentBtn) el.detachParentBtn.hidden = true;
      if (el.assignParentBtn) el.assignParentBtn.hidden = false;
    }
  }

  try {
    // Use team-scoped URL if on team page
    const teamSlug = el.form?.dataset.teamSlug;
    const url = teamSlug
      ? `/t/${teamSlug}/api/todos/${todoId}/subtasks`
      : `/api/todos/${todoId}/subtasks`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[TaskModal] Failed to fetch subtasks:", res.status);
      return;
    }

    const data = await res.json();

    // If this is a subtask, show parent info
    if (data.parent) {
      setParentState('has-parent', data.parent);
      // Hide add subtask button for subtasks (2-level max)
      if (el.addSubtaskBtn) el.addSubtaskBtn.hidden = true;
      return;
    }

    // If this has subtasks, show subtasks section (can't become a subtask)
    if (data.subtasks && data.subtasks.length > 0) {
      setParentState('hidden'); // Can't assign parent to a task that has subtasks
      if (el.subtasksSection) el.subtasksSection.hidden = false;
      if (el.addSubtaskBtn) el.addSubtaskBtn.hidden = !data.canAddSubtask;
      renderSubtasksList(data.subtasks);
      return;
    }

    // Task has no parent and no subtasks - show "no parent" option and subtasks section
    setParentState('no-parent');
    if (data.canAddSubtask) {
      if (el.subtasksSection) el.subtasksSection.hidden = false;
      if (el.addSubtaskBtn) el.addSubtaskBtn.hidden = false;
      renderSubtasksList([]);
    }
  } catch (err) {
    console.error("[TaskModal] Failed to fetch subtasks:", err);
  }
}

function renderSubtasksList(subtasks) {
  if (!el.subtasksList) return;

  if (subtasks.length === 0) {
    el.subtasksList.innerHTML = '<div class="subtask-empty">No subtasks yet</div>';
    return;
  }

  el.subtasksList.innerHTML = subtasks.map((s) => `
    <div class="subtask-item" data-subtask-id="${s.id}">
      <span class="subtask-item-state state-${s.state}">${formatState(s.state)}</span>
      <span class="subtask-item-title">${escapeHtml(s.title)}</span>
      <button type="button" class="subtask-item-detach" data-detach-subtask="${s.id}" title="Remove from parent">&times;</button>
    </div>
  `).join("");

  // Make subtasks clickable to open their modal
  el.subtasksList.querySelectorAll("[data-subtask-id]").forEach((item) => {
    item.addEventListener("click", (e) => {
      // Don't navigate if clicking the detach button
      if (e.target.matches("[data-detach-subtask]")) return;
      const subtaskId = item.dataset.subtaskId;
      closeModal();
      // Small delay to allow modal to close before reopening
      setTimeout(() => openModalForTaskById(subtaskId), 100);
    });
  });

  // Wire up detach buttons
  el.subtasksList.querySelectorAll("[data-detach-subtask]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const subtaskId = btn.dataset.detachSubtask;
      if (!confirm("Remove this subtask from the parent? It will become a regular task.")) return;

      const store = window.__kanbanStore;
      if (store) {
        const success = await store.detachFromParent(Number(subtaskId));
        if (success) {
          // Remove the subtask item from the list
          const item = btn.closest("[data-subtask-id]");
          if (item) item.remove();
          // Check if list is now empty
          if (el.subtasksList.querySelectorAll("[data-subtask-id]").length === 0) {
            el.subtasksList.innerHTML = '<div class="subtask-empty">No subtasks yet</div>';
          }
          return;
        }
      }
      // Fallback: reload
      window.location.reload();
    });
  });
}

function formatState(state) {
  const labels = {
    new: "New",
    ready: "Ready",
    in_progress: "In Progress",
    review: "Review",
    done: "Done",
    archived: "Archived",
  };
  return labels[state] || state;
}

function handleAddSubtask() {
  if (!currentTaskId) return;

  // Get current task info before closing modal
  const parentId = currentTaskId;
  const parentTitle = el.title?.value || "Parent Task";
  const groupId = el.groupId?.value || "";

  // Close current modal and open create modal for subtask
  closeModal();

  // Small delay to let modal close animation complete
  setTimeout(() => {
    openModalForCreate({
      parentId: Number(parentId),
      parentTitle,
      groupId,
    });
  }, 100);
}

function handleParentClick() {
  const parentId = el.parentWrapper?.dataset.parentId;
  if (!parentId) return;

  // Close current modal and open parent task modal
  closeModal();

  // Small delay to let modal close animation complete
  setTimeout(() => {
    openModalForTaskById(parentId);
  }, 100);
}

async function handleDetachFromParent(e) {
  e.stopPropagation(); // Don't trigger parent click

  if (!currentTaskId) return;

  if (!confirm("Remove this task from its parent? It will become a regular task.")) return;

  // Use kanban store for live update if available
  const store = window.__kanbanStore;
  if (store) {
    const success = await store.detachFromParent(Number(currentTaskId));
    if (success) {
      // Switch parent wrapper to "no parent" mode
      if (el.parentTitle) el.parentTitle.hidden = true;
      if (el.detachParentBtn) el.detachParentBtn.hidden = true;
      if (el.assignParentBtn) el.assignParentBtn.hidden = false;
      // Show add subtask button and subtasks section since this task can now have children
      if (el.addSubtaskBtn) el.addSubtaskBtn.hidden = false;
      if (el.subtasksSection) el.subtasksSection.hidden = false;
      return;
    }
  }

  // Fallback: reload page
  window.location.reload();
}

async function openModalForTaskById(taskId) {
  // Find the card on the page
  const card = document.querySelector(`[data-todo-id="${taskId}"]`);
  if (card) {
    openModalForTask(taskId, card);
  } else {
    // Card not visible - reload page to see it
    window.location.reload();
  }
}

// ==================== Parent Picker Functions ====================

let potentialParentsList = [];

async function handleOpenParentPicker() {
  if (!currentTaskId) return;

  // Show the picker
  if (el.parentPicker) el.parentPicker.hidden = false;
  if (el.parentPickerFilter) {
    el.parentPickerFilter.value = "";
    el.parentPickerFilter.focus();
  }

  // Fetch potential parents
  const teamSlug = el.form?.dataset.teamSlug;
  const url = teamSlug
    ? `/t/${teamSlug}/api/todos/${currentTaskId}/potential-parents`
    : `/api/todos/${currentTaskId}/potential-parents`;

  try {
    if (el.parentPickerList) {
      el.parentPickerList.innerHTML = '<div class="parent-picker-loading">Loading...</div>';
    }

    const res = await fetch(url);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (el.parentPickerList) {
        el.parentPickerList.innerHTML = `<div class="parent-picker-error">${escapeHtml(data.error || "Failed to load tasks")}</div>`;
      }
      return;
    }

    const data = await res.json();
    potentialParentsList = data.potentialParents || [];
    renderPotentialParents(potentialParentsList);
  } catch (err) {
    console.error("[TaskModal] Failed to fetch potential parents:", err);
    if (el.parentPickerList) {
      el.parentPickerList.innerHTML = '<div class="parent-picker-error">Failed to load tasks</div>';
    }
  }
}

function closeParentPicker() {
  if (el.parentPicker) el.parentPicker.hidden = true;
  potentialParentsList = [];
}

function handleParentPickerFilter() {
  const filter = el.parentPickerFilter?.value?.toLowerCase() || "";
  const filtered = potentialParentsList.filter((p) =>
    p.title.toLowerCase().includes(filter)
  );
  renderPotentialParents(filtered);
}

function renderPotentialParents(parents) {
  if (!el.parentPickerList) return;

  if (parents.length === 0) {
    el.parentPickerList.innerHTML = '<div class="parent-picker-empty">No matching tasks found</div>';
    return;
  }

  el.parentPickerList.innerHTML = parents.map((p) => `
    <div class="parent-picker-item" data-parent-id="${p.id}">
      <span class="parent-picker-item-state state-${p.state}">${formatState(p.state)}</span>
      <span class="parent-picker-item-title">${escapeHtml(p.title)}</span>
    </div>
  `).join("");

  // Add click handlers
  el.parentPickerList.querySelectorAll("[data-parent-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const parentId = Number(item.dataset.parentId);
      handleSelectParent(parentId);
    });
  });
}

async function handleSelectParent(parentId) {
  if (!currentTaskId) return;

  // Use kanban store for live update if available
  const store = window.__kanbanStore;
  if (store) {
    const success = await store.setParent(Number(currentTaskId), parentId);
    if (success) {
      closeParentPicker();
      // Refresh the subtasks display to show new parent
      await fetchAndDisplaySubtasks(currentTaskId);
      return;
    }
  }

  // Fallback: use API directly
  const teamSlug = el.form?.dataset.teamSlug;
  const url = teamSlug
    ? `/t/${teamSlug}/api/todos/${currentTaskId}/parent`
    : `/api/todos/${currentTaskId}/parent`;

  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: parentId }),
    });

    if (res.ok) {
      closeParentPicker();
      // Refresh to show the change
      window.location.reload();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to set parent");
    }
  } catch (err) {
    console.error("[TaskModal] Failed to set parent:", err);
    alert("Failed to set parent");
  }
}
