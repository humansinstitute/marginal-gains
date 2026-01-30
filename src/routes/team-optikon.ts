/**
 * Team-scoped Optikon Routes
 *
 * These routes handle Optikon visual board integration with tasks.
 * The actual board creation happens client-side (requires NIP-98 signing),
 * these endpoints just save/retrieve the board references.
 */

import { OPTIKON_URL } from "../config";
import { createTeamRouteContext } from "../context";
import { TeamDatabase } from "../team-db";

import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * PATCH /t/:slug/api/todos/:id/optikon
 * Save an Optikon board link to a task
 */
export async function handleSetTodoOptikonBoard(
  req: Request,
  session: Session | null,
  teamSlug: string,
  todoId: number
) {
  const result = createTeamRouteContext(session, teamSlug);
  if (!result.ok) return result.response;

  let body: { boardId: number; boardUrl: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const { boardId, boardUrl } = body;

  if (!boardId || typeof boardId !== "number") {
    return new Response(JSON.stringify({ error: "boardId is required" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  if (!boardUrl || typeof boardUrl !== "string") {
    return new Response(JSON.stringify({ error: "boardUrl is required" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const db = new TeamDatabase(result.ctx.teamDb);

  // Verify todo exists
  const todo = db.getTodoById(todoId);
  if (!todo) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  // Update the todo with Optikon board info
  const updated = db.setTodoOptikonBoard(todoId, boardId, boardUrl);
  if (!updated) {
    return new Response(JSON.stringify({ error: "Failed to save board link" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ todo: updated }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * DELETE /t/:slug/api/todos/:id/optikon
 * Remove Optikon board link from a task
 */
export async function handleClearTodoOptikonBoard(
  session: Session | null,
  teamSlug: string,
  todoId: number
) {
  const result = createTeamRouteContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);

  // Verify todo exists
  const todo = db.getTodoById(todoId);
  if (!todo) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const updated = db.clearTodoOptikonBoard(todoId);
  if (!updated) {
    return new Response(JSON.stringify({ error: "Failed to clear board link" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ todo: updated }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * GET /t/:slug/groups/:id/optikon-workspace
 * Get the default Optikon workspace for a group
 */
export async function handleGetGroupOptikonWorkspace(
  session: Session | null,
  teamSlug: string,
  groupId: number
) {
  const result = createTeamRouteContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);

  const workspaceId = db.getGroupOptikonWorkspace(groupId);

  return new Response(JSON.stringify({ workspaceId }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * PATCH /t/:slug/groups/:id/optikon-workspace
 * Set the default Optikon workspace for a group
 */
export async function handleSetGroupOptikonWorkspace(
  req: Request,
  session: Session | null,
  teamSlug: string,
  groupId: number
) {
  const result = createTeamRouteContext(session, teamSlug);
  if (!result.ok) return result.response;

  let body: { workspaceId: number | null };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const { workspaceId } = body;

  // Allow null to clear the workspace
  if (workspaceId !== null && (typeof workspaceId !== "number" || workspaceId <= 0)) {
    return new Response(JSON.stringify({ error: "workspaceId must be a positive number or null" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const db = new TeamDatabase(result.ctx.teamDb);

  // Verify group exists
  const group = db.getGroup(groupId);
  if (!group) {
    return new Response(JSON.stringify({ error: "Group not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const updated = db.setGroupOptikonWorkspace(groupId, workspaceId);
  if (!updated) {
    return new Response(JSON.stringify({ error: "Failed to update workspace" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ group: updated }), {
    status: 200,
    headers: jsonHeaders,
  });
}

/**
 * GET /t/:slug/api/optikon/config
 * Get Optikon configuration for the client (URL, etc.)
 */
export function handleGetOptikonConfig(session: Session | null, teamSlug: string) {
  const result = createTeamRouteContext(session, teamSlug);
  if (!result.ok) return result.response;

  return new Response(JSON.stringify({ optikonUrl: OPTIKON_URL }), {
    status: 200,
    headers: jsonHeaders,
  });
}
