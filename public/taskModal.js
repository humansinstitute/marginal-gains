import { show, hide } from "./dom.js";

let currentTaskId = null;
let currentTaskOwner = null;

const el = {
  overlay: null,
  form: null,
  title: null,
  description: null,
  priority: null,
  state: null,
  scheduled: null,
  board: null,
  groupId: null,
  assignee: null,
  assigneeLabel: null,
  tagsWrapper: null,
  tagsHidden: null,
  closeBtn: null,
  cancelBtn: null,
  deleteBtn: null,
};

export function initTaskModal() {
  el.overlay = document.querySelector("[data-task-modal]");
  el.form = document.querySelector("[data-task-modal-form]");
  el.title = document.querySelector("[data-task-modal-title]");
  el.description = document.querySelector("[data-task-modal-description]");
  el.priority = document.querySelector("[data-task-modal-priority]");
  el.state = document.querySelector("[data-task-modal-state]");
  el.scheduled = document.querySelector("[data-task-modal-scheduled]");
  el.board = document.querySelector("[data-task-modal-board]");
  el.groupId = document.querySelector("[data-task-modal-group-id]");
  el.assignee = document.querySelector("[data-task-modal-assignee]");
  el.assigneeLabel = document.querySelector("[data-task-modal-assignee-label]");
  el.tagsWrapper = document.querySelector("[data-task-modal-tags-wrapper]");
  el.tagsHidden = document.querySelector("[data-task-modal-tags-hidden]");
  el.closeBtn = document.querySelector("[data-task-modal-close]");
  el.cancelBtn = document.querySelector("[data-task-modal-cancel]");
  el.deleteBtn = document.querySelector("[data-task-modal-delete]");

  if (!el.overlay) return;

  // Close handlers
  el.closeBtn?.addEventListener("click", closeModal);
  el.cancelBtn?.addEventListener("click", closeModal);
  el.overlay?.addEventListener("click", (e) => {
    if (e.target === el.overlay) closeModal();
  });

  // Delete handler
  el.deleteBtn?.addEventListener("click", handleDelete);

  // Form submit
  el.form?.addEventListener("submit", handleSubmit);

  // Board change handler
  el.board?.addEventListener("change", handleBoardChange);

  // Tag input handling
  initTagInput();

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

function openModalForTask(todoId, card) {
  currentTaskId = todoId;

  // Extract data from the card
  const title = card.querySelector(".kanban-card-title")?.textContent || "";
  const desc = card.querySelector(".kanban-card-desc")?.textContent || "";
  const state = card.dataset.todoState || "ready";
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

  populateModal({ title, description: desc, priority, state, scheduled_for: "", tags, assigned_to, group_id });
  show(el.overlay);
  el.title?.focus();
}

function openModalFromListItem(todoId, details) {
  currentTaskId = todoId;

  // Extract data from the details element
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

  populateModal({ title, description, priority, state, scheduled_for, tags, assigned_to, group_id });
  show(el.overlay);
  el.title?.focus();
}

function populateModal({ title, description, priority, state, scheduled_for, tags, assigned_to, group_id }) {
  if (el.title) el.title.value = title;
  if (el.description) el.description.value = description;
  if (el.priority) el.priority.value = priority;
  if (el.state) el.state.value = state;
  if (el.scheduled) el.scheduled.value = scheduled_for || "";
  if (el.tagsHidden) el.tagsHidden.value = tags || "";

  // Set board selector and hidden group_id
  if (el.board) el.board.value = group_id || "";
  if (el.groupId) el.groupId.value = group_id || "";

  // Update assignee field visibility and value based on board
  updateAssigneeVisibility(group_id);
  if (el.assignee) el.assignee.value = assigned_to || "";

  // If switching to a group board, fetch members for assignee dropdown
  if (group_id) {
    fetchGroupMembers(group_id).then(() => {
      if (el.assignee) el.assignee.value = assigned_to || "";
    });
  }

  // Update form action
  if (el.form) {
    el.form.action = `/todos/${currentTaskId}/update`;
  }

  // Render tag chips
  renderTagChips(tags);
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
  if (!currentTaskId || !el.form) return;

  // Sync tags before submit
  syncTagsHidden();

  // Submit the form normally (will redirect)
  el.form.submit();
}

async function handleDelete() {
  if (!currentTaskId) return;

  if (!confirm("Are you sure you want to delete this task?")) return;

  // Create and submit a delete form
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `/todos/${currentTaskId}/delete`;
  document.body.appendChild(form);
  form.submit();
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
  }
}

async function fetchGroupMembers(groupId) {
  if (!el.assignee || !groupId) return;

  try {
    const res = await fetch(`/api/groups/${groupId}/members`);
    if (!res.ok) return;

    const data = await res.json();
    const members = data.members || [];

    // Rebuild assignee dropdown options
    const currentValue = el.assignee.value;
    el.assignee.innerHTML = `<option value="">Unassigned</option>` +
      members.map(m => {
        const displayName = m.display_name || m.npub.slice(0, 12) + "...";
        return `<option value="${m.npub}">${escapeHtml(displayName)}</option>`;
      }).join("");

    // Restore previous value if still valid
    if (currentValue && members.some(m => m.npub === currentValue)) {
      el.assignee.value = currentValue;
    }
  } catch (err) {
    console.error("Failed to fetch group members:", err);
  }
}

function escapeHtml(str) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, (c) => escapes[c]);
}
