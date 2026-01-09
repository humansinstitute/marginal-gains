import { getTodoById } from "../db";
import { redirect, unauthorized } from "../http";
import {
  canManageGroupTodo,
  moveTaskToBoard,
  quickAddTodo,
  removeGroupTodo,
  removeTodo,
  transitionGroupTodoState,
  transitionTodoState,
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

  // Check permission for group todo
  if (groupId && !canManageGroupTodo(session.npub, groupId)) {
    return new Response("Forbidden", { status: 403 });
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

    let updated;
    if (groupId && Number.isInteger(groupId) && groupId > 0) {
      if (!canManageGroupTodo(session.npub, groupId)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders });
      }
      updated = transitionGroupTodoState(groupId, id, nextState);
    } else {
      updated = transitionTodoState(session.npub, id, nextState);
    }

    if (!updated) {
      return new Response(JSON.stringify({ error: "Invalid state transition or todo not found" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, state: nextState }), { status: 200, headers: jsonHeaders });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: jsonHeaders });
  }
}
