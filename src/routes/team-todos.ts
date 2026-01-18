/**
 * Team-scoped Todo Routes
 *
 * These routes handle todo/task operations within a team context.
 * Todos are stored in the team's database, not the main database.
 */

import { createTeamRouteContext } from "../context";
import { isAllowedTransition } from "../domain/todos";
import { redirect } from "../http";
import { renderTeamTodosPage } from "../render/home";
import { TeamDatabase } from "../team-db";
import { normalizeStateInput, validateTodoForm, validateTodoTitle } from "../validation";

import { getTeamBranding } from "./app-settings";

import type { ViewMode } from "../routes/home";
import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

// Helper to create and validate team context with return path for auth redirect
function requireTeamContext(session: Session | null, teamSlug: string, returnPath?: string) {
  return createTeamRouteContext(session, teamSlug, returnPath);
}

function getRedirectUrl(teamSlug: string, groupId: number | null): string {
  const base = `/t/${teamSlug}/todo/kanban`;
  return groupId ? `${base}?group=${groupId}` : base;
}

function parseGroupId(value: FormDataEntryValue | null): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * Check if a user can manage todos in a team group.
 * Team owners/managers can always manage. Group creators and members can manage their groups.
 */
function canManageTeamGroupTodo(
  db: TeamDatabase,
  npub: string,
  groupId: number,
  memberRole: string | undefined
): boolean {
  // Team owners and managers can manage any group
  if (memberRole === "owner" || memberRole === "manager") return true;

  // Check if user is the group creator
  const group = db.getGroup(groupId);
  if (!group) return false;
  if (group.created_by === npub) return true;

  // Check if user is a group member
  const members = db.listGroupMembers(groupId);
  return members.some((m) => m.npub === npub);
}

/**
 * GET /t/:slug/todo - Redirect to default view (kanban)
 */
export function handleTeamTodosRedirect(url: URL, teamSlug: string) {
  const newUrl = new URL(url);
  newUrl.pathname = `/t/${teamSlug}/todo/kanban`;
  return new Response(null, {
    status: 302,
    headers: { Location: newUrl.pathname + newUrl.search },
  });
}

/**
 * GET /t/:slug/todo/kanban or /t/:slug/todo/list - Team todos page
 */
export function handleTeamTodos(url: URL, session: Session | null, teamSlug: string, viewMode: ViewMode = "kanban") {
  const result = requireTeamContext(session, teamSlug, url.pathname + url.search);
  if (!result.ok) return result.response;

  const tagsParam = url.searchParams.get("tags");
  const filterTags = tagsParam
    ? tagsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const showArchive = url.searchParams.get("archive") === "1";

  // Parse group context
  const groupParam = url.searchParams.get("group");
  const groupId = groupParam ? Number(groupParam) : null;

  const db = new TeamDatabase(result.ctx.teamDb);

  let todos: ReturnType<typeof db.listTodos> = [];
  const userGroups = db.getGroupsForUser(result.ctx.session.npub);
  let selectedGroup: ReturnType<typeof db.getGroup> = null;
  let canManage = true; // default for personal todos

  // Get the user's membership for permission checks
  const membership = result.ctx.session.teamMemberships?.find(
    (m) => m.teamSlug === teamSlug
  );

  if (groupId && Number.isInteger(groupId) && groupId > 0) {
    // Viewing group todos
    selectedGroup = db.getGroup(groupId) ?? null;
    if (selectedGroup) {
      todos = db.listGroupTodos(groupId, filterTags);
      canManage = canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role);
    }
  } else {
    // Viewing personal todos within this team
    todos = db.listTodos(result.ctx.session.npub, filterTags);
  }

  const branding = getTeamBranding(teamSlug);
  const page = renderTeamTodosPage({
    showArchive,
    session: result.ctx.session,
    filterTags,
    todos,
    userGroups,
    selectedGroup,
    canManage,
    teamSlug,
    viewMode,
    branding,
  });

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * POST /t/:slug/todos - Create a new todo
 */
export async function handleTeamTodoCreate(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const form = await req.formData();
  const title = String(form.get("title") ?? "");
  const tags = String(form.get("tags") ?? "");
  const groupId = parseGroupId(form.get("group_id"));
  const parentId = parseGroupId(form.get("parent_id"));

  const db = new TeamDatabase(result.ctx.teamDb);

  // Check permission for group todo
  if (groupId) {
    const membership = result.ctx.session.teamMemberships?.find(
      (m) => m.teamSlug === teamSlug
    );
    if (!canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role)) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const normalizedTitle = validateTodoTitle(title);
  if (!normalizedTitle) {
    return redirect(getRedirectUrl(teamSlug, groupId));
  }

  // If parent_id is provided, create as subtask
  if (parentId) {
    const parent = db.getTodoById(parentId);
    if (!parent) {
      // Redirect back instead of 404 to avoid breaking the UI
      return redirect(getRedirectUrl(teamSlug, groupId));
    }
    if (!db.canHaveChildren(parent)) {
      // Redirect back instead of 400 to avoid breaking the UI
      return redirect(getRedirectUrl(teamSlug, groupId));
    }
    try {
      db.addSubtask(normalizedTitle, parentId, result.ctx.session.npub);
      // Sync parent state to match slowest subtask
      db.updateParentStateFromSubtasks(parentId);
    } catch (err) {
      console.error("[TeamTodos] Error creating subtask:", err);
    }
    // Always redirect to the parent's context
    const redirectUrl = getRedirectUrl(teamSlug, parent.group_id);
    console.log("[TeamTodos] Subtask created, redirecting to:", redirectUrl);
    return redirect(redirectUrl);
  }

  db.addTodo(normalizedTitle, result.ctx.session.npub, tags, groupId);
  return redirect(getRedirectUrl(teamSlug, groupId));
}

/**
 * POST /t/:slug/todos/:id/update - Update a todo
 */
export async function handleTeamTodoUpdate(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const form = await req.formData();
  const groupId = parseGroupId(form.get("group_id"));

  const db = new TeamDatabase(result.ctx.teamDb);

  const fields = validateTodoForm({
    title: form.get("title"),
    description: form.get("description"),
    priority: form.get("priority"),
    state: form.get("state"),
    scheduled_for: form.get("scheduled_for"),
    tags: form.get("tags"),
  });

  if (!fields) {
    return redirect(getRedirectUrl(teamSlug, groupId));
  }

  if (groupId) {
    const membership = result.ctx.session.teamMemberships?.find(
      (m) => m.teamSlug === teamSlug
    );
    if (!canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role)) {
      return new Response("Forbidden", { status: 403 });
    }
    db.updateGroupTodo({
      id,
      groupId,
      title: fields.title,
      description: fields.description,
      priority: fields.priority,
      state: fields.state,
      scheduledFor: fields.scheduled_for,
      tags: fields.tags,
      assignedTo: fields.assigned_to,
    });
  } else {
    db.updateTodo({
      id,
      owner: result.ctx.session.npub,
      title: fields.title,
      description: fields.description,
      priority: fields.priority,
      state: fields.state,
      scheduledFor: fields.scheduled_for,
      tags: fields.tags,
      assignedTo: fields.assigned_to,
    });
  }

  // Propagate tags to children if this is a parent task
  if (db.hasSubtasks(id)) {
    db.propagateTagsToChildren(id, fields.tags);
  }

  return redirect(getRedirectUrl(teamSlug, groupId));
}

/**
 * POST /t/:slug/todos/:id/state - Change todo state
 */
export async function handleTeamTodoState(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const form = await req.formData();
  const nextState = normalizeStateInput(String(form.get("state") ?? "ready"));
  const groupId = parseGroupId(form.get("group_id"));

  const db = new TeamDatabase(result.ctx.teamDb);

  // Verify the todo exists and check transition
  const existing = db.getTodoById(id);
  if (!existing) {
    return redirect(getRedirectUrl(teamSlug, groupId));
  }

  if (!isAllowedTransition(existing.state, nextState)) {
    return redirect(getRedirectUrl(teamSlug, groupId));
  }

  if (groupId) {
    const membership = result.ctx.session.teamMemberships?.find(
      (m) => m.teamSlug === teamSlug
    );
    if (!canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role)) {
      return new Response("Forbidden", { status: 403 });
    }
    db.transitionGroupTodo(id, groupId, nextState);
  } else {
    db.transitionTodo(id, result.ctx.session.npub, nextState);
  }

  return redirect(getRedirectUrl(teamSlug, groupId));
}

/**
 * POST /t/:slug/todos/:id/delete - Delete a todo
 */
export async function handleTeamTodoDelete(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const form = await req.formData();
  const groupId = parseGroupId(form.get("group_id"));

  const db = new TeamDatabase(result.ctx.teamDb);

  if (groupId) {
    const membership = result.ctx.session.teamMemberships?.find(
      (m) => m.teamSlug === teamSlug
    );
    if (!canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role)) {
      return new Response("Forbidden", { status: 403 });
    }
    db.deleteGroupTodo(id, groupId);
  } else {
    db.deleteTodo(id, result.ctx.session.npub);
  }

  return redirect(getRedirectUrl(teamSlug, groupId));
}

/**
 * POST /t/:slug/api/todos/:id/state - JSON API for state changes (Kanban drag-drop)
 */
export async function handleTeamApiTodoState(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  try {
    const body = await req.json();
    const nextState = normalizeStateInput(String(body.state ?? "ready"));
    // Position is optional - only provided when reordering within column
    const position = typeof body.position === "number" ? body.position : null;

    const db = new TeamDatabase(result.ctx.teamDb);

    // Verify the todo exists
    const existing = db.getTodoById(id);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Todo not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    // Note: For kanban drag-drop, we allow any state transition (including backward moves
    // like in_progress -> new). The strict state machine rules are for lifecycle buttons only.

    // Use the todo's actual group_id from the database, not from the client
    // This ensures subtasks (which inherit group_id from parent) work correctly
    const actualGroupId = existing.group_id;

    let updated;
    if (actualGroupId && Number.isInteger(actualGroupId) && actualGroupId > 0) {
      const membership = result.ctx.session.teamMemberships?.find(
        (m) => m.teamSlug === teamSlug
      );
      if (!canManageTeamGroupTodo(db, result.ctx.session.npub, actualGroupId, membership?.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: jsonHeaders,
        });
      }
      // Use position-aware function when position is provided
      updated = position !== null
        ? db.transitionGroupTodoWithPosition(id, actualGroupId, nextState, position)
        : db.transitionGroupTodo(id, actualGroupId, nextState);
    } else {
      // For non-group todos, use the todo's actual owner (subtasks inherit owner from parent)
      // This allows team members to update subtasks even if they didn't create the parent
      const todoOwner = existing.owner || result.ctx.session.npub;
      updated = position !== null
        ? db.transitionTodoWithPosition(id, todoOwner, nextState, position)
        : db.transitionTodo(id, todoOwner, nextState);
    }

    if (!updated) {
      return new Response(JSON.stringify({ error: "Failed to update todo" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, state: nextState, position }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
}

/**
 * POST /t/:slug/api/todos/:id/position - JSON API for position-only updates (Summary card reordering)
 */
export async function handleTeamApiTodoPosition(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  try {
    const body = await req.json();
    const position = typeof body.position === "number" ? body.position : null;

    if (position === null) {
      return new Response(JSON.stringify({ error: "Position is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const db = new TeamDatabase(result.ctx.teamDb);

    // Verify the todo exists
    const todo = db.getTodoById(id);
    if (!todo) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    const updated = db.updateTodoPosition(id, position);
    if (!updated) {
      return new Response(JSON.stringify({ error: "Failed to update position" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, position }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
}

/**
 * GET /t/:slug/api/todos/:id - Get full task details
 */
export function handleTeamGetTodo(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const todo = db.getTodoById(id);

  if (!todo) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify(todo), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * GET /t/:slug/api/todos/:id/subtasks - List subtasks and parent info
 */
export function handleTeamGetSubtasks(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const todo = db.getTodoById(id);

  if (!todo) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const subtasks = db.listSubtasks(id);
  const canAddSubtask = db.canHaveChildren(todo);

  // Get parent info if this is a subtask
  let parent = null;
  if (todo.parent_id) {
    const parentTodo = db.getTodoById(todo.parent_id);
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

/**
 * POST /t/:slug/api/todos/:id/subtasks - Create a subtask
 */
export async function handleTeamCreateSubtask(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const db = new TeamDatabase(result.ctx.teamDb);
  const parent = db.getTodoById(id);

  if (!parent) {
    return new Response(JSON.stringify({ error: "Parent task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  // Check 2-level max rule
  if (!db.canHaveChildren(parent)) {
    return new Response(
      JSON.stringify({ error: "Subtasks cannot have children (2 levels max)" }),
      { status: 400, headers: jsonHeaders }
    );
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

    const subtask = db.addSubtask(title, id, result.ctx.session.npub);

    if (!subtask) {
      return new Response(
        JSON.stringify({ error: "Failed to create subtask" }),
        { status: 500, headers: jsonHeaders }
      );
    }

    // Sync parent state to match slowest subtask
    const updatedParent = db.updateParentStateFromSubtasks(id);

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
