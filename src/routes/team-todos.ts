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
 * Team owners/managers can always manage. Group creators can manage their groups.
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
  return group?.created_by === npub;
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
    });
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
    const groupId = body.group_id ? Number(body.group_id) : null;

    const db = new TeamDatabase(result.ctx.teamDb);

    // Verify the todo exists
    const existing = db.getTodoById(id);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Todo not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    if (!isAllowedTransition(existing.state, nextState)) {
      return new Response(JSON.stringify({ error: "Invalid state transition" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    let updated;
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
      updated = db.transitionGroupTodo(id, groupId, nextState);
    } else {
      updated = db.transitionTodo(id, result.ctx.session.npub, nextState);
    }

    if (!updated) {
      return new Response(JSON.stringify({ error: "Failed to update todo" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, state: nextState }), {
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
