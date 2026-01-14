/**
 * Team-scoped Task Routes
 *
 * These routes handle task-thread linking operations within a team context.
 * Tasks and links are stored in the team's database, not the main database.
 */

import { createTeamRouteContext } from "../context";
import { jsonResponse } from "../http";
import { TeamDatabase } from "../team-db";
import { validateTaskInput } from "../validation";

import type { Session } from "../types";

// Helper to create and validate team context
function requireTeamContext(session: Session | null, teamSlug: string) {
  return createTeamRouteContext(session, teamSlug);
}

/**
 * GET /t/:slug/api/tasks/search - Search tasks by title
 */
export function handleTeamSearchTasks(url: URL, session: Session | null, teamSlug: string) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const query = url.searchParams.get("q")?.toLowerCase().trim() ?? "";
  const groupId = url.searchParams.get("group_id");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);

  const db = new TeamDatabase(result.ctx.teamDb);
  let tasks: ReturnType<typeof db.listTodos> = [];

  if (groupId) {
    const gid = Number(groupId);
    if (Number.isInteger(gid) && gid > 0) {
      tasks = db.listGroupTodos(gid);
    }
  } else {
    // Search user's personal tasks
    tasks = db.listTodos(result.ctx.session.npub);
  }

  // Filter by query if provided
  if (query) {
    tasks = tasks.filter(
      (t) => t.title.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
    );
  }

  // Limit results
  tasks = tasks.slice(0, limit);

  return jsonResponse({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      priority: t.priority,
      group_id: t.group_id,
    })),
  });
}

/**
 * GET /t/:slug/api/tasks/:todoId/threads - List threads linked to a task
 */
export function handleTeamGetTaskThreads(
  session: Session | null,
  teamSlug: string,
  todoId: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const todo = db.getTodoById(todoId);
  if (!todo) {
    return jsonResponse({ error: "Task not found" }, 404);
  }

  // Check access to the task
  if (todo.group_id) {
    // For group tasks, anyone in the group should be able to see threads
    // (permission check is relaxed for viewing)
  } else if (todo.owner !== result.ctx.session.npub) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const threads = db.getThreadsForTask(todoId);
  return jsonResponse({ threads });
}

/**
 * GET /t/:slug/api/threads/:messageId/tasks - List tasks linked to a thread
 */
export function handleTeamGetThreadTasks(
  session: Session | null,
  teamSlug: string,
  messageId: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const message = db.getMessage(messageId);
  if (!message) {
    return jsonResponse({ error: "Message not found" }, 404);
  }

  const tasks = db.getTasksForThread(messageId);
  return jsonResponse({ tasks });
}

/**
 * POST /t/:slug/api/tasks - Create a new task with optional thread link
 */
export async function handleTeamCreateTask(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  try {
    const body = await req.json();
    const groupId = body.group_id ? Number(body.group_id) : null;
    const threadId = body.thread_id ? Number(body.thread_id) : null;

    const db = new TeamDatabase(result.ctx.teamDb);

    // Check group permission - user must be a group member
    if (groupId) {
      const members = db.listGroupMembers(groupId);
      const isMember = members.some((m) => m.npub === result.ctx.session.npub);
      if (!isMember) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    }

    // Validate the task input
    const fields = validateTaskInput({
      title: body.title,
      description: body.description,
      priority: body.priority,
      state: body.state,
      scheduled_for: body.scheduled_for,
      tags: body.tags,
    });

    if (!fields) {
      return jsonResponse({ error: "Invalid task data" }, 400);
    }

    // Create the task
    const todo = db.addTodoFull({
      title: fields.title,
      owner: result.ctx.session.npub,
      description: fields.description,
      priority: fields.priority,
      state: fields.state,
      tags: fields.tags,
      scheduledFor: fields.scheduled_for,
      groupId,
    });

    if (!todo) {
      return jsonResponse({ error: "Failed to create task" }, 500);
    }

    // If a thread_id was provided, link it
    let link = null;
    if (threadId) {
      const message = db.getMessage(threadId);
      if (message) {
        link = db.linkThreadToTask(todo.id, threadId, result.ctx.session.npub);
      }
    }

    return jsonResponse({ success: true, task: todo, link }, 201);
  } catch (_err) {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }
}

/**
 * POST /t/:slug/api/tasks/:todoId/link - Link a thread to a task
 */
export async function handleTeamLinkThreadToTask(
  req: Request,
  session: Session | null,
  teamSlug: string,
  todoId: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  try {
    const body = await req.json();
    const messageId = Number(body.message_id);

    if (!messageId || !Number.isInteger(messageId)) {
      return jsonResponse({ error: "Invalid message_id" }, 400);
    }

    const db = new TeamDatabase(result.ctx.teamDb);

    // Verify the task exists
    const todo = db.getTodoById(todoId);
    if (!todo) {
      return jsonResponse({ error: "Task not found" }, 404);
    }

    // Check permission to link to this task
    if (todo.group_id) {
      const members = db.listGroupMembers(todo.group_id);
      const isMember = members.some((m) => m.npub === result.ctx.session.npub);
      if (!isMember) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    } else if (todo.owner !== result.ctx.session.npub) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    // Verify the message (thread root) exists
    const message = db.getMessage(messageId);
    if (!message) {
      return jsonResponse({ error: "Message not found" }, 404);
    }

    // Create the link
    const link = db.linkThreadToTask(todoId, messageId, result.ctx.session.npub);
    if (!link) {
      // Already linked (UNIQUE constraint ON CONFLICT DO NOTHING)
      const existing = db.getTaskThreadLink(todoId, messageId);
      if (existing) {
        return jsonResponse({ success: true, link: existing, already_linked: true });
      }
      return jsonResponse({ error: "Failed to create link" }, 500);
    }

    return jsonResponse({ success: true, link });
  } catch (_err) {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }
}

/**
 * DELETE /t/:slug/api/tasks/:todoId/unlink/:messageId - Unlink a thread from a task
 */
export function handleTeamUnlinkThreadFromTask(
  session: Session | null,
  teamSlug: string,
  todoId: number,
  messageId: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);

  // Verify the task exists
  const todo = db.getTodoById(todoId);
  if (!todo) {
    return jsonResponse({ error: "Task not found" }, 404);
  }

  // Check permission: only the linker, task owner, group member can unlink
  const link = db.getTaskThreadLink(todoId, messageId);
  if (!link) {
    return jsonResponse({ error: "Link not found" }, 404);
  }

  let canUnlink = link.linked_by === result.ctx.session.npub || todo.owner === result.ctx.session.npub;

  if (todo.group_id && !canUnlink) {
    const members = db.listGroupMembers(todo.group_id);
    canUnlink = members.some((m) => m.npub === result.ctx.session.npub);
  }

  if (!canUnlink) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  db.unlinkThreadFromTask(todoId, messageId);
  return jsonResponse({ success: true });
}
