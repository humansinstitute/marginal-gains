import type { TodoPriority, TodoState } from "../types";

export const TODO_STATES: TodoState[] = ["new", "ready", "in_progress", "review", "done", "archived"];

// Active states (excludes archived) - used for kanban columns
export const ACTIVE_TODO_STATES: TodoState[] = ["new", "ready", "in_progress", "review", "done"];
export const TODO_PRIORITIES: TodoPriority[] = ["rock", "pebble", "sand"];

// State ordering for computing parent display column (lower = earlier in workflow)
export const STATE_ORDER: Record<TodoState, number> = {
  new: 0,
  ready: 1,
  in_progress: 2,
  review: 3,
  done: 4,
  archived: 5,
};

// Get the minimum (leftmost) state from a list of states
export function getMinState(states: TodoState[]): TodoState {
  if (states.length === 0) return "new";
  return states.reduce((min, state) =>
    STATE_ORDER[state] < STATE_ORDER[min] ? state : min
  );
}

export const ALLOWED_STATE_TRANSITIONS: Record<TodoState, TodoState[]> = {
  new: ["ready", "in_progress", "review", "done"],
  ready: ["new", "in_progress", "review", "done"],
  in_progress: ["ready", "review", "done"],
  review: ["in_progress", "done"],
  done: ["ready", "in_progress", "review", "archived"],
  archived: ["done", "ready", "in_progress", "review"],
};

export function normalizePriority(input: string): TodoPriority {
  const value = input.toLowerCase();
  if (TODO_PRIORITIES.includes(value as TodoPriority)) {
    return value as TodoPriority;
  }
  return "sand";
}

export function normalizeState(input: string): TodoState {
  const value = input.toLowerCase();
  if (TODO_STATES.includes(value as TodoState)) {
    return value as TodoState;
  }
  return "ready";
}

export function isAllowedTransition(current: TodoState, next: TodoState) {
  return ALLOWED_STATE_TRANSITIONS[current]?.includes(next) ?? false;
}

export function formatStateLabel(state: TodoState) {
  if (state === "in_progress") return "In Progress";
  if (state === "review") return "Review";
  if (state === "archived") return "Archived";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

// Days threshold for auto-archiving tasks when moved to done
export const AUTO_ARCHIVE_DAYS = 7;

// Check if a task should be auto-archived when moved to done
export function shouldAutoArchive(updatedAt: number | string): boolean {
  const updatedDate = typeof updatedAt === 'string' ? new Date(updatedAt).getTime() : updatedAt;
  const now = Date.now();
  const daysSinceUpdate = (now - updatedDate) / (1000 * 60 * 60 * 24);
  return daysSinceUpdate > AUTO_ARCHIVE_DAYS;
}

export function formatPriorityLabel(priority: TodoPriority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}
