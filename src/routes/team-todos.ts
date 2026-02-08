/**
 * Team-scoped Todo Routes
 *
 * These routes handle todo/task operations within a team context.
 * Todos are stored in the team's database, not the main database.
 */

import { finalizeEvent } from "nostr-tools";

import { getWingmanIdentity } from "../config";
import { createTeamRouteContext } from "../context";
import { isAllowedTransition } from "../domain/todos";
import { redirect } from "../http";
import { findUserByWingmanNpub, getUserSetting } from "../master-db";
import { renderTeamTodosPage } from "../render/home";
import { createAndBroadcastActivity } from "../services/activities";
import { publishTaskAssignment } from "../services/nostr-notify";
import { TeamDatabase } from "../team-db";
import { normalizeStateInput, validateTaskInput, validateTodoForm, validateTodoTitle } from "../validation";

import { getTeamBranding } from "./app-settings";

import type { ViewMode } from "../routes/home";
import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

// Helper to create and validate team context with return path for auth redirect
// When no returnPath is given (API routes), use isApi mode for proper 401 JSON responses
function requireTeamContext(session: Session | null, teamSlug: string, returnPath?: string) {
  return createTeamRouteContext(session, teamSlug, returnPath ?? { isApi: true });
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
    working_directory: form.get("working_directory"),
  });

  if (!fields) {
    return redirect(getRedirectUrl(teamSlug, groupId));
  }

  // Fetch existing todo before update for comparison
  const existingTodo = db.getTodoById(id);

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
      workingDirectory: fields.working_directory,
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
      workingDirectory: fields.working_directory,
    });
  }

  // Create activities for task assignment/update
  if (existingTodo) {
    const taskTitle = fields.title || existingTodo.title;
    // Assignment changed
    if (fields.assigned_to && fields.assigned_to !== existingTodo.assigned_to) {
      createAndBroadcastActivity(teamSlug, result.ctx.teamDb, {
        targetNpub: fields.assigned_to,
        type: "task_assigned",
        sourceNpub: result.ctx.session.npub,
        todoId: id,
        summary: `assigned you to "${taskTitle}"`,
      });

      // Send Nostr notification (fire-and-forget)
      publishTaskAssignment({
        assigneeNpub: fields.assigned_to,
        teamSlug,
        taskId: id,
        taskTitle,
        taskDescription: existingTodo.description || "",
        workingDirectory: fields.working_directory || existingTodo.working_directory || undefined,
      }).catch((err) => console.error("[Nostr] Task assignment notification failed:", err));
    }
    // Notify assignee of update (if updated by someone else)
    if (existingTodo.assigned_to && existingTodo.assigned_to !== result.ctx.session.npub) {
      createAndBroadcastActivity(teamSlug, result.ctx.teamDb, {
        targetNpub: existingTodo.assigned_to,
        type: "task_update",
        sourceNpub: result.ctx.session.npub,
        todoId: id,
        summary: `updated "${taskTitle}"`,
      });
    }
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

  // Notify assignee of state change
  if (existing.assigned_to && existing.assigned_to !== result.ctx.session.npub) {
    createAndBroadcastActivity(teamSlug, result.ctx.teamDb, {
      targetNpub: existing.assigned_to,
      type: "task_update",
      sourceNpub: result.ctx.session.npub,
      todoId: id,
      summary: `moved "${existing.title}" to ${nextState}`,
    });
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
  if (!result.ok) return result.response;

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

    // Notify assignee of state change
    if (existing.assigned_to && existing.assigned_to !== result.ctx.session.npub) {
      createAndBroadcastActivity(teamSlug, result.ctx.teamDb, {
        targetNpub: existing.assigned_to,
        type: "task_update",
        sourceNpub: result.ctx.session.npub,
        todoId: id,
        summary: `moved "${existing.title}" to ${nextState}`,
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
  if (!result.ok) return result.response;

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
  if (!result.ok) return result.response;

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
  if (!result.ok) return result.response;

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
  if (!result.ok) return result.response;

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

/**
 * DELETE /t/:slug/api/todos/:id/parent - Detach a subtask from its parent
 */
export function handleTeamDetachFromParent(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const task = db.getTodoById(id);

  if (!task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  if (!task.parent_id) {
    return new Response(JSON.stringify({ error: "Task is not a subtask" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const { task: updated, formerParentId } = db.detachFromParent(id);

  // Check if former parent still has subtasks and update its state
  let formerParentHasChildren = false;
  let formerParentState: string | null = null;
  if (formerParentId) {
    formerParentHasChildren = db.hasSubtasks(formerParentId);
    if (formerParentHasChildren) {
      // Recalculate parent state based on remaining subtasks
      const updatedParent = db.updateParentStateFromSubtasks(formerParentId);
      formerParentState = updatedParent?.state ?? null;
    }
  }

  return new Response(JSON.stringify({
    success: true,
    task: updated,
    formerParentId,
    formerParentHasChildren,
    formerParentState,
  }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * GET /t/:slug/api/todos/:id/potential-parents - List tasks that can be parents
 */
export function handleTeamListPotentialParents(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const task = db.getTodoById(id);

  if (!task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  // Can't set parent if task already has a parent or has subtasks
  if (task.parent_id !== null) {
    return new Response(JSON.stringify({
      error: "Task already has a parent",
      potentialParents: [],
    }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  if (db.hasSubtasks(id)) {
    return new Response(JSON.stringify({
      error: "Task has subtasks and cannot become a subtask",
      potentialParents: [],
    }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const potentialParents = db.listPotentialParents(id);

  return new Response(JSON.stringify({
    potentialParents: potentialParents.map((p) => ({
      id: p.id,
      title: p.title,
      state: p.state,
      priority: p.priority,
    })),
  }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * PATCH /t/:slug/api/todos/:id/parent - Set a task's parent
 */
export async function handleTeamSetParent(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);

  let body: { parent_id?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const parentId = body.parent_id;
  if (!parentId || typeof parentId !== "number") {
    return new Response(JSON.stringify({ error: "parent_id is required" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const updated = db.setParent(id, parentId);

  if (!updated) {
    return new Response(JSON.stringify({
      error: "Cannot set parent. Task may already have a parent, be a parent itself, or target is invalid.",
    }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // Update the new parent's state based on its new subtask
  db.updateParentStateFromSubtasks(parentId);
  const parent = db.getTodoById(parentId);

  return new Response(JSON.stringify({
    success: true,
    task: updated,
    parent: parent ? {
      id: parent.id,
      title: parent.title,
      state: parent.state,
    } : null,
  }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * POST /t/:slug/api/todos - JSON API for creating a task (live hero form)
 */
export async function handleTeamApiTodoCreate(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  try {
    const body = await req.json();
    const title = validateTodoTitle(String(body.title ?? ""));
    const tags = String(body.tags ?? "");
    const groupId = typeof body.group_id === "number" ? body.group_id : null;

    if (!title) {
      return new Response(JSON.stringify({ error: "Title is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const db = new TeamDatabase(result.ctx.teamDb);

    // Check permission for group todo
    if (groupId) {
      const membership = result.ctx.session.teamMemberships?.find(
        (m) => m.teamSlug === teamSlug
      );
      if (!canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: jsonHeaders,
        });
      }
    }

    const todo = db.addTodo(title, result.ctx.session.npub, tags, groupId);

    if (!todo) {
      return new Response(JSON.stringify({ error: "Failed to create task" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, todo }), {
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

/**
 * PATCH /t/:slug/api/todos/:id - JSON API for updating a task
 */
export async function handleTeamApiTodoUpdate(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  try {
    const body = await req.json();
    const fields = validateTaskInput(body);

    if (!fields) {
      return new Response(JSON.stringify({ error: "Invalid task data" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const db = new TeamDatabase(result.ctx.teamDb);

    // Verify the todo exists
    const existing = db.getTodoById(id);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    // Use the task's actual group_id from the database
    const groupId = existing.group_id;

    if (groupId && Number.isInteger(groupId) && groupId > 0) {
      const membership = result.ctx.session.teamMemberships?.find(
        (m) => m.teamSlug === teamSlug
      );
      if (!canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: jsonHeaders,
        });
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
        workingDirectory: fields.working_directory,
      });
    } else {
      db.updateTodo({
        id,
        owner: existing.owner || result.ctx.session.npub,
        title: fields.title,
        description: fields.description,
        priority: fields.priority,
        state: fields.state,
        scheduledFor: fields.scheduled_for,
        tags: fields.tags,
        assignedTo: fields.assigned_to,
        workingDirectory: fields.working_directory,
      });
    }

    // Create activities for task assignment/update
    const taskTitle = fields.title || existing.title;
    if (fields.assigned_to && fields.assigned_to !== existing.assigned_to) {
      createAndBroadcastActivity(teamSlug, result.ctx.teamDb, {
        targetNpub: fields.assigned_to,
        type: "task_assigned",
        sourceNpub: result.ctx.session.npub,
        todoId: id,
        summary: `assigned you to "${taskTitle}"`,
      });

      // Send Nostr notification (fire-and-forget)
      publishTaskAssignment({
        assigneeNpub: fields.assigned_to,
        teamSlug,
        taskId: id,
        taskTitle,
        taskDescription: existing.description || "",
        workingDirectory: fields.working_directory || existing.working_directory || undefined,
      }).catch((err) => console.error("[Nostr] Task assignment notification failed:", err));
    }
    if (existing.assigned_to && existing.assigned_to !== result.ctx.session.npub) {
      createAndBroadcastActivity(teamSlug, result.ctx.teamDb, {
        targetNpub: existing.assigned_to,
        type: "task_update",
        sourceNpub: result.ctx.session.npub,
        todoId: id,
        summary: `updated "${taskTitle}"`,
      });
    }

    // Propagate tags to children if this is a parent task
    if (db.hasSubtasks(id)) {
      db.propagateTagsToChildren(id, fields.tags);
    }

    // Return the updated task
    const updated = db.getTodoById(id);
    return new Response(JSON.stringify({ success: true, todo: updated }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
}

/**
 * DELETE /t/:slug/api/todos/:id - JSON API for deleting a task
 */
export function handleTeamApiTodoDelete(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);

  // Verify the todo exists
  const existing = db.getTodoById(id);
  if (!existing) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  // Use the task's actual group_id from the database
  const groupId = existing.group_id;

  if (groupId && Number.isInteger(groupId) && groupId > 0) {
    const membership = result.ctx.session.teamMemberships?.find(
      (m) => m.teamSlug === teamSlug
    );
    if (!canManageTeamGroupTodo(db, result.ctx.session.npub, groupId, membership?.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }
    db.deleteGroupTodo(id, groupId);
  } else {
    db.deleteTodo(id, existing.owner || result.ctx.session.npub);
  }

  return new Response(JSON.stringify({ success: true, id }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * GET /t/:slug/api/wingman/projects?npub={npub} - Proxy to Wingmen for project list
 *
 * Looks up the Wingmen URL from user_settings (the user who configured this
 * wingman npub), then signs the outbound request with NIP-98 using WINGMAN_KEY.
 */
export async function handleTeamWingmanProjects(
  url: URL,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const npub = url.searchParams.get("npub");
  if (!npub) {
    return new Response(JSON.stringify({ error: "npub parameter required" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // Find which user configured this wingman npub
  const ownerNpub = findUserByWingmanNpub(npub);
  if (!ownerNpub) {
    return new Response(JSON.stringify({ projects: [] }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  // Get that user's wingmen_url
  const wingmenUrl = getUserSetting(ownerNpub, "wingmen_url");
  if (!wingmenUrl) {
    return new Response(JSON.stringify({ projects: [] }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  const identity = getWingmanIdentity();
  if (!identity) {
    return new Response(JSON.stringify({ error: "Server signing key not configured" }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  // Build the target URL
  const targetUrl = `${wingmenUrl}/api/npub-projects?npub=${encodeURIComponent(npub)}`;

  // Sign NIP-98 event for the outbound request
  const nip98Event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", targetUrl],
      ["method", "GET"],
    ],
    content: "",
  }, identity.secretKey);

  const token = `Nostr ${btoa(JSON.stringify(nip98Event))}`;

  try {
    const res = await fetch(targetUrl, {
      headers: { Authorization: token },
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error("[Wingman Proxy] Failed to fetch projects:", err);
    return new Response(JSON.stringify({ error: "Failed to fetch projects from Wingmen" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
}
