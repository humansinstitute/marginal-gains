import {
  addSubtask,
  canHaveChildren,
  getTodoById,
  hasSubtasks,
  listSubtasks,
  updateParentStateFromSubtasks,
} from "../db";
import { redirect, unauthorized } from "../http";
import {
  canManageGroupTodo,
  moveTaskToBoard,
  quickAddTodo,
  removeGroupTodo,
  removeTodo,
  setTodoPosition,
  transitionGroupTodoState,
  transitionGroupTodoStateWithPosition,
  transitionTodoState,
  transitionTodoStateWithPosition,
  updateGroupTodoFromForm,
  updateTodoFromForm,
} from "../services/todos";
import { normalizeStateInput } from "../validation";

import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

function getRedirectUrl(groupId: number | null): string {
  return groupId ? `/todo?group=${groupId}` : "/todo";
}

function parseGroupId(value: FormDataEntryValue | null): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

export async function handleTodoCreate(req: Request, session: Session | null) {
  if (!session) return unauthorized();
  const form = await req.formData();
  const title = String(form.get("title") ?? "");
  const tags = String(form.get("tags") ?? "");
  const groupId = parseGroupId(form.get("group_id"));
  const parentId = parseGroupId(form.get("parent_id"));

  // Check permission for group todo
  if (groupId && !canManageGroupTodo(session.npub, groupId)) {
    return new Response("Forbidden", { status: 403 });
  }

  // If parent_id is provided, create as subtask
  if (parentId) {
    const parent = getTodoById(parentId);
    if (!parent) {
      return new Response("Parent task not found", { status: 404 });
    }
    if (!canHaveChildren(parent)) {
      return new Response("Subtasks cannot have children (2 levels max)", { status: 400 });
    }
    addSubtask(title, parentId, session.npub);
    // Sync parent state to match slowest subtask
    updateParentStateFromSubtasks(parentId);
    // Redirect to the parent's context (group or personal)
    return redirect(getRedirectUrl(parent.group_id));
  }

  quickAddTodo(session.npub, title, tags, groupId);
  return redirect(getRedirectUrl(groupId));
}

export async function handleTodoUpdate(req: Request, session: Session | null, id: number) {
  if (!session) return unauthorized();
  const form = await req.formData();
  const newGroupId = parseGroupId(form.get("group_id"));

  // Check if the board is changing
  const currentTodo = getTodoById(id);
  if (!currentTodo) {
    return new Response("Task not found", { status: 404 });
  }

  const currentGroupId = currentTodo.group_id;
  const boardIsChanging = currentGroupId !== newGroupId;

  // If board is changing, move the task first
  if (boardIsChanging) {
    const moveResult = moveTaskToBoard(session.npub, id, newGroupId);
    if (!moveResult.success) {
      return new Response(moveResult.error || "Failed to move task", { status: 403 });
    }
  }

  // Now perform the regular update on the new board
  if (newGroupId) {
    if (!canManageGroupTodo(session.npub, newGroupId)) {
      return new Response("Forbidden", { status: 403 });
    }
    updateGroupTodoFromForm(newGroupId, id, form);
  } else {
    updateTodoFromForm(session.npub, id, form);
  }

  return redirect(getRedirectUrl(newGroupId));
}

export async function handleTodoState(req: Request, session: Session | null, id: number) {
  if (!session) return unauthorized();
  const form = await req.formData();
  const nextState = normalizeStateInput(String(form.get("state") ?? "ready"));
  const groupId = parseGroupId(form.get("group_id"));

  if (groupId) {
    if (!canManageGroupTodo(session.npub, groupId)) {
      return new Response("Forbidden", { status: 403 });
    }
    transitionGroupTodoState(groupId, id, nextState);
  } else {
    transitionTodoState(session.npub, id, nextState);
  }

  return redirect(getRedirectUrl(groupId));
}

export async function handleTodoDelete(req: Request, session: Session | null, id: number) {
  if (!session) return unauthorized();
  const form = await req.formData();
  const groupId = parseGroupId(form.get("group_id"));

  if (groupId) {
    if (!canManageGroupTodo(session.npub, groupId)) {
      return new Response("Forbidden", { status: 403 });
    }
    removeGroupTodo(groupId, id);
  } else {
    removeTodo(session.npub, id);
  }

  return redirect(getRedirectUrl(groupId));
}

// JSON API endpoint for state updates (used by Kanban drag-drop)
export async function handleApiTodoState(req: Request, session: Session | null, id: number) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  try {
    const body = await req.json();
    const nextState = normalizeStateInput(String(body.state ?? "ready"));
    const groupId = body.group_id ? Number(body.group_id) : null;
    // Position is optional - only provided when reordering within column
    const position = typeof body.position === "number" ? body.position : null;

    let updated;
    if (groupId && Number.isInteger(groupId) && groupId > 0) {
      if (!canManageGroupTodo(session.npub, groupId)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders });
      }
      // Use position-aware function when position is provided
      updated = position !== null
        ? transitionGroupTodoStateWithPosition(groupId, id, nextState, position)
        : transitionGroupTodoState(groupId, id, nextState);
    } else {
      // Use position-aware function when position is provided
      updated = position !== null
        ? transitionTodoStateWithPosition(session.npub, id, nextState, position)
        : transitionTodoState(session.npub, id, nextState);
    }

    if (!updated) {
      return new Response(JSON.stringify({ error: "Invalid state transition or todo not found" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, state: nextState, position }), { status: 200, headers: jsonHeaders });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: jsonHeaders });
  }
}

/**
 * POST /api/todos/:id/position - JSON API for position-only updates (Summary card reordering)
 */
export async function handleApiTodoPosition(req: Request, session: Session | null, id: number) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  try {
    const body = await req.json();
    const position = typeof body.position === "number" ? body.position : null;

    if (position === null) {
      return new Response(JSON.stringify({ error: "Position is required" }), { status: 400, headers: jsonHeaders });
    }

    // Verify the todo exists and belongs to the user
    const todo = getTodoById(id);
    if (!todo) {
      return new Response(JSON.stringify({ error: "Task not found" }), { status: 404, headers: jsonHeaders });
    }

    // Check ownership - task must belong to the user
    if (todo.owner !== session.npub) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders });
    }

    const updated = setTodoPosition(id, position);
    if (!updated) {
      return new Response(JSON.stringify({ error: "Failed to update position" }), { status: 400, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ success: true, position }), { status: 200, headers: jsonHeaders });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: jsonHeaders });
  }
}

// GET /api/todos/:id/subtasks - List subtasks and parent info
export function handleGetSubtasks(
  _req: Request,
  session: Session | null,
  id: number
) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const todo = getTodoById(id);
  if (!todo) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const subtasks = listSubtasks(id);
  const canAddSubtask = canHaveChildren(todo);

  // Get parent info if this is a subtask
  let parent = null;
  if (todo.parent_id) {
    const parentTodo = getTodoById(todo.parent_id);
    if (parentTodo) {
      parent = { id: parentTodo.id, title: parentTodo.title };
    }
  }

  return new Response(
    JSON.stringify({
      subtasks,
      canAddSubtask,
      parent,
      hasSubtasks: subtasks.length > 0,
    }),
    { status: 200, headers: jsonHeaders }
  );
}

// POST /api/todos/:id/subtasks - Create a subtask
export async function handleCreateSubtask(
  req: Request,
  session: Session | null,
  id: number
) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const parent = getTodoById(id);
  if (!parent) {
    return new Response(JSON.stringify({ error: "Parent task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  // Check 2-level max rule
  if (!canHaveChildren(parent)) {
    return new Response(
      JSON.stringify({ error: "Subtasks cannot have children (2 levels max)" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  // Check permission for group todo
  if (parent.group_id && !canManageGroupTodo(session.npub, parent.group_id)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: jsonHeaders,
    });
  }

  try {
    const body = await req.json();
    const title = String(body.title ?? "").trim();

    if (!title) {
      return new Response(JSON.stringify({ error: "Title is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const subtask = addSubtask(title, id, session.npub);

    if (!subtask) {
      return new Response(
        JSON.stringify({ error: "Failed to create subtask" }),
        { status: 500, headers: jsonHeaders }
      );
    }

    // Sync parent state to match slowest subtask
    const updatedParent = updateParentStateFromSubtasks(id);

    return new Response(JSON.stringify({ success: true, subtask, parentState: updatedParent?.state }), {
      status: 201,
      headers: jsonHeaders,
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
}

// GET /api/todos/:id/has-subtasks - Quick check if task has subtasks (for delete confirmation)
export function handleHasSubtasks(
  _req: Request,
  session: Session | null,
  id: number
) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const has = hasSubtasks(id);
  const count = has ? listSubtasks(id).length : 0;

  return new Response(JSON.stringify({ hasSubtasks: has, count }), {
    status: 200,
    headers: jsonHeaders,
  });
}
