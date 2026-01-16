import { isAdmin } from "../config";
import {
  addTodo,
  addTodoFull,
  deleteTodo,
  deleteGroupTodo,
  getGroup,
  getLatestSummaries,
  getTodoById,
  listAllAssignedTodos,
  listGroupMembers,
  listGroupTodos,
  listScheduledTodos,
  listTodos,
  listUnscheduledTodos,
  moveTodoToBoard,
  syncParentStateAfterSubtaskChange,
  transitionGroupTodo,
  transitionGroupTodoWithPosition,
  transitionTodo,
  transitionTodoWithPosition,
  updateGroupTodo,
  updateTodo,
  updateTodoPosition,
  upsertSummary,
} from "../db";
import { isAllowedTransition, normalizePriority, normalizeState, shouldAutoArchive, TODO_PRIORITIES, TODO_STATES } from "../domain/todos";
import { formatLocalDate } from "../utils/date";
import { normalizeStateInput, validateTaskInput, validateTodoForm, validateTodoTitle } from "../validation";

import type { TodoState } from "../types";

export const TODO_STATE_OPTIONS = TODO_STATES;
export const TODO_PRIORITY_OPTIONS = TODO_PRIORITIES;

/**
 * Apply auto-archive logic: if transitioning to 'done' and the task
 * hasn't been updated in over 7 days, archive it instead.
 */
function applyAutoArchive(targetState: TodoState, updatedAt: string): TodoState {
  if (targetState === "done" && shouldAutoArchive(updatedAt)) {
    return "archived";
  }
  return targetState;
}

/**
 * Check if a user can manage todos in a group.
 * Only system admins and group creators can manage group todos.
 */
export function canManageGroupTodo(npub: string, groupId: number): boolean {
  if (isAdmin(npub)) return true;
  const group = getGroup(groupId);
  return group?.created_by === npub;
}

/**
 * Move a task to a different board with proper assignee handling.
 * - Personal → Group: Keep assigned to mover (easier to find on group board)
 * - Group → Personal: Set assignee to owner
 * - Group → Different Group: Clear assignee (user may not be in new group)
 */
export function moveTaskToBoard(
  npub: string,
  todoId: number,
  newGroupId: number | null
): { success: boolean; error?: string } {
  // Get the current task
  const todo = getTodoById(todoId);
  if (!todo) {
    return { success: false, error: "Task not found" };
  }

  // Only the task owner can move it
  if (todo.owner !== npub) {
    return { success: false, error: "Only the task owner can move it" };
  }

  const currentGroupId = todo.group_id;

  // No change needed
  if (currentGroupId === newGroupId) {
    return { success: true };
  }

  // Check permissions on the new board if it's a group
  if (newGroupId !== null && !canManageGroupTodo(npub, newGroupId)) {
    return { success: false, error: "You don't have permission to move tasks to this group" };
  }

  // Determine new assignee based on move direction
  let newAssignee: string | null;
  if (newGroupId === null) {
    // Moving to personal board - assign to owner
    newAssignee = npub;
  } else if (currentGroupId === null) {
    // Moving from personal to group - keep assigned to mover
    newAssignee = npub;
  } else {
    // Moving between groups - keep assignee if they're a member of the target group
    const currentAssignee = todo.assigned_to;
    if (currentAssignee) {
      const targetMembers = listGroupMembers(newGroupId);
      const isMemberOfTarget = targetMembers.some(m => m.npub === currentAssignee);
      newAssignee = isMemberOfTarget ? currentAssignee : null;
    } else {
      newAssignee = null;
    }
  }

  // Perform the move
  const updated = moveTodoToBoard(todoId, npub, newGroupId, newAssignee);
  if (!updated) {
    return { success: false, error: "Failed to move task" };
  }

  return { success: true };
}

export function listOwnerTodos(owner: string | null) {
  return listTodos(owner);
}

export function listTodosForGroup(groupId: number, filterTags?: string[], assigneeFilter?: string) {
  return listGroupTodos(groupId, filterTags, assigneeFilter);
}

export function listAllUserAssignedTodos(npub: string, filterTags?: string[]) {
  return listAllAssignedTodos(npub, filterTags);
}

export function listOwnerScheduled(owner: string, endDate: string) {
  return listScheduledTodos(owner, endDate);
}

export function listOwnerUnscheduled(owner: string) {
  return listUnscheduledTodos(owner);
}

export function createTodoFromForm(owner: string, form: FormData, groupId: number | null = null) {
  const fields = validateTodoForm({
    title: form.get("title"),
    description: form.get("description"),
    priority: form.get("priority"),
    state: form.get("state"),
    scheduled_for: form.get("scheduled_for"),
    tags: form.get("tags"),
    assigned_to: form.get("assigned_to"),
  });
  if (!fields) return null;
  // For personal tasks (no group), default assignee to owner
  if (groupId === null && !fields.assigned_to) {
    fields.assigned_to = owner;
  }
  return addTodoFull(owner, fields, groupId);
}

export function quickAddTodo(owner: string, title: string, tags: string, groupId: number | null = null, assignedTo: string | null = null) {
  const normalizedTitle = validateTodoTitle(title);
  if (!normalizedTitle) return null;
  const normalizedTags = tags?.trim() ?? "";
  // For personal tasks (no group), default assignee to owner
  const effectiveAssignee = groupId === null ? owner : assignedTo;
  return addTodo(normalizedTitle, owner, normalizedTags, groupId, effectiveAssignee);
}

export function updateTodoFromForm(owner: string, id: number, form: FormData) {
  const fields = validateTodoForm({
    title: form.get("title"),
    description: form.get("description"),
    priority: form.get("priority"),
    state: form.get("state"),
    scheduled_for: form.get("scheduled_for"),
    tags: form.get("tags"),
    assigned_to: form.get("assigned_to"),
  });
  if (!fields) return null;
  return updateTodo(id, owner, fields);
}

export function transitionTodoState(owner: string, id: number, state: string) {
  const normalized = normalizeStateInput(state);
  const existing = listTodos(owner).find((todo) => todo.id === id);
  if (!existing) return null;
  if (!isAllowedTransition(existing.state, normalized)) return null;

  // Auto-archive: if moving to done and task is old enough, archive instead
  const finalState = applyAutoArchive(normalized, existing.updated_at);

  const result = transitionTodo(id, owner, finalState);
  // If this is a subtask, sync the parent's state
  if (result) syncParentStateAfterSubtaskChange(id);
  return result;
}

export function transitionTodoStateWithPosition(owner: string, id: number, state: string, position: number | null) {
  const normalized = normalizeStateInput(state);
  const existing = listTodos(owner).find((todo) => todo.id === id);
  if (!existing) return null;
  // For kanban drag-drop, allow any state transition (including backward moves)
  // This enables dragging tasks to any column

  // Auto-archive: if moving to done and task is old enough, archive instead
  const finalState = applyAutoArchive(normalized, existing.updated_at);

  const result = transitionTodoWithPosition(id, owner, finalState, position);
  // If this is a subtask, sync the parent's state
  if (result) syncParentStateAfterSubtaskChange(id);
  return result;
}

export function setTodoPosition(id: number, position: number | null) {
  return updateTodoPosition(id, position);
}

export function removeTodo(owner: string, id: number) {
  return deleteTodo(id, owner);
}

// Group todo operations
export function updateGroupTodoFromForm(groupId: number, id: number, form: FormData) {
  const fields = validateTodoForm({
    title: form.get("title"),
    description: form.get("description"),
    priority: form.get("priority"),
    state: form.get("state"),
    scheduled_for: form.get("scheduled_for"),
    tags: form.get("tags"),
    assigned_to: form.get("assigned_to"),
  });
  if (!fields) return null;
  return updateGroupTodo(id, groupId, fields);
}

export function transitionGroupTodoState(groupId: number, id: number, state: string) {
  const normalized = normalizeStateInput(state);
  const existing = getTodoById(id);
  if (!existing || existing.group_id !== groupId) return null;
  if (!isAllowedTransition(existing.state, normalized)) return null;

  // Auto-archive: if moving to done and task is old enough, archive instead
  const finalState = applyAutoArchive(normalized, existing.updated_at);

  const result = transitionGroupTodo(id, groupId, finalState);
  // If this is a subtask, sync the parent's state
  if (result) syncParentStateAfterSubtaskChange(id);
  return result;
}

export function transitionGroupTodoStateWithPosition(groupId: number, id: number, state: string, position: number | null) {
  const normalized = normalizeStateInput(state);
  const existing = getTodoById(id);
  if (!existing || existing.group_id !== groupId) return null;
  // For kanban drag-drop, allow any state transition (including backward moves)
  // This enables dragging tasks to any column

  // Auto-archive: if moving to done and task is old enough, archive instead
  const finalState = applyAutoArchive(normalized, existing.updated_at);

  const result = transitionGroupTodoWithPosition(id, groupId, finalState, position);
  // If this is a subtask, sync the parent's state
  if (result) syncParentStateAfterSubtaskChange(id);
  return result;
}

export function removeGroupTodo(groupId: number, id: number) {
  return deleteGroupTodo(id, groupId);
}

export function createTodosFromTasks(owner: string, tasks: Array<Record<string, any>>) {
  const created = [];
  const failed: Array<{ index: number; title?: string; reason: string }> = [];

  for (let i = 0; i < tasks.length; i++) {
    const fields = validateTaskInput(tasks[i]);
    if (!fields) {
      failed.push({ index: i, title: tasks[i]?.title, reason: "Missing or invalid title." });
      continue;
    }
    const todo = addTodoFull(owner, fields);
    if (todo) created.push(todo);
    else failed.push({ index: i, title: fields.title, reason: "Failed to create task." });
  }

  return { created, failed };
}

export function persistSummary(payload: {
  owner: string;
  summary_date: string;
  day_ahead: string | null;
  week_ahead: string | null;
  suggestions: string | null;
}) {
  if (!payload.day_ahead && !payload.week_ahead && !payload.suggestions) {
    return null;
  }
  return upsertSummary({
    owner: payload.owner,
    summaryDate: payload.summary_date,
    dayAhead: payload.day_ahead,
    weekAhead: payload.week_ahead,
    suggestions: payload.suggestions,
  });
}

export function latestSummaries(owner: string, today: Date) {
  const todayString = formatLocalDate(today);
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  return getLatestSummaries(owner, todayString, formatLocalDate(weekStart), formatLocalDate(weekEnd));
}

export function normalizeSummaryText(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10000);
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day + 6) % 7;
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export { normalizePriority, normalizeState };
