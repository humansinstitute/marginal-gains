import {
  addTodoFull,
  getCrmLinksForTask,
  getCrmLinksWithDetails,
  getGroup,
  getGroupsForUser,
  getTasksForActivity,
  getTasksForCompany,
  getTasksForContact,
  getTasksForOpportunity,
  getTasksForThread,
  getTaskThreadLink,
  getMessage,
  getThreadsForTask,
  getTodoById,
  linkTaskToCrm,
  linkThreadToTask,
  listGroupTodos,
  listTodos,
  unlinkTaskFromCrm,
  unlinkThreadFromTask,
  getCrmContact,
  getCrmCompany,
  getCrmActivity,
  getCrmOpportunity,
} from "../db";
import { canManageGroupTodo } from "../services/todos";
import { validateTaskInput } from "../validation";

import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });
}

function jsonSuccess(data: object, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

/**
 * POST /api/tasks/:todoId/threads - Link a thread to a task
 */
export async function handleLinkThreadToTask(req: Request, session: Session | null, todoId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await req.json();
    const messageId = Number(body.message_id);

    if (!messageId || !Number.isInteger(messageId)) {
      return jsonError("Invalid message_id", 400);
    }

    // Verify the task exists
    const todo = getTodoById(todoId);
    if (!todo) return jsonError("Task not found", 404);

    // Check permission to link to this task
    if (todo.group_id) {
      if (!canManageGroupTodo(session.npub, todo.group_id)) {
        return jsonError("Forbidden", 403);
      }
    } else if (todo.owner !== session.npub) {
      return jsonError("Forbidden", 403);
    }

    // Verify the message (thread root) exists
    const message = getMessage(messageId);
    if (!message) return jsonError("Message not found", 404);

    // Create the link
    const link = linkThreadToTask(todoId, messageId, session.npub);
    if (!link) {
      // Already linked (UNIQUE constraint ON CONFLICT DO NOTHING)
      const existing = getTaskThreadLink(todoId, messageId);
      if (existing) {
        return jsonSuccess({ success: true, link: existing, already_linked: true });
      }
      return jsonError("Failed to create link", 500);
    }

    return jsonSuccess({ success: true, link });
  } catch (_err) {
    return jsonError("Invalid request body", 400);
  }
}

/**
 * DELETE /api/tasks/:todoId/threads/:messageId - Unlink a thread from a task
 */
export function handleUnlinkThreadFromTask(session: Session | null, todoId: number, messageId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  // Verify the task exists
  const todo = getTodoById(todoId);
  if (!todo) return jsonError("Task not found", 404);

  // Check permission: only the linker, task owner, group admin can unlink
  const link = getTaskThreadLink(todoId, messageId);
  if (!link) return jsonError("Link not found", 404);

  const canUnlink =
    link.linked_by === session.npub ||
    todo.owner === session.npub ||
    (todo.group_id && canManageGroupTodo(session.npub, todo.group_id));

  if (!canUnlink) return jsonError("Forbidden", 403);

  unlinkThreadFromTask(todoId, messageId);
  return jsonSuccess({ success: true });
}

/**
 * GET /api/tasks/:todoId/threads - List threads linked to a task
 */
export function handleGetTaskThreads(session: Session | null, todoId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const todo = getTodoById(todoId);
  if (!todo) return jsonError("Task not found", 404);

  // Check access to the task
  if (todo.group_id) {
    // For group tasks, anyone in the group should be able to see threads
    // (permission check is relaxed for viewing)
  } else if (todo.owner !== session.npub) {
    return jsonError("Forbidden", 403);
  }

  const threads = getThreadsForTask(todoId);
  return jsonSuccess({ threads });
}

/**
 * GET /api/threads/:messageId/tasks - List tasks linked to a thread
 */
export function handleGetThreadTasks(session: Session | null, messageId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const message = getMessage(messageId);
  if (!message) return jsonError("Message not found", 404);

  const tasks = getTasksForThread(messageId);
  return jsonSuccess({ tasks });
}

/**
 * POST /api/tasks - Create a new task with optional thread or CRM entity link
 */
export async function handleCreateTask(req: Request, session: Session | null) {
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await req.json();
    const groupId = body.group_id ? Number(body.group_id) : null;
    const threadId = body.thread_id ? Number(body.thread_id) : null;

    // CRM entity IDs (optional)
    const contactId = body.contact_id ? Number(body.contact_id) : null;
    const companyId = body.company_id ? Number(body.company_id) : null;
    const activityId = body.activity_id ? Number(body.activity_id) : null;
    const opportunityId = body.opportunity_id ? Number(body.opportunity_id) : null;

    // Check group permission
    if (groupId && !canManageGroupTodo(session.npub, groupId)) {
      return jsonError("Forbidden", 403);
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
      return jsonError("Invalid task data", 400);
    }

    // Create the task
    const todo = addTodoFull(session.npub, fields, groupId);
    if (!todo) {
      return jsonError("Failed to create task", 500);
    }

    // If a thread_id was provided, link it
    let threadLink = null;
    if (threadId) {
      const message = getMessage(threadId);
      if (message) {
        threadLink = linkThreadToTask(todo.id, threadId, session.npub);
      }
    }

    // If CRM entity IDs were provided, link them
    let crmLink = null;
    if (contactId || companyId || activityId || opportunityId) {
      crmLink = linkTaskToCrm(
        todo.id,
        { contactId: contactId ?? undefined, companyId: companyId ?? undefined, activityId: activityId ?? undefined, opportunityId: opportunityId ?? undefined },
        session.npub
      );
    }

    return jsonSuccess({ success: true, task: todo, threadLink, crmLink }, 201);
  } catch (_err) {
    return jsonError("Invalid request body", 400);
  }
}

/**
 * GET /api/tasks/search?q=... - Search tasks by title
 * Supports group_id=all to search across all user's groups + personal tasks
 */
export function handleSearchTasks(url: URL, session: Session | null) {
  if (!session) return jsonError("Unauthorized", 401);

  const query = url.searchParams.get("q")?.toLowerCase().trim() ?? "";
  const groupId = url.searchParams.get("group_id");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);

  let tasks: (ReturnType<typeof listTodos>[0] & { group_name?: string | null })[] = [];

  if (groupId === "all") {
    // Search across all user's groups + personal tasks
    const userGroups = getGroupsForUser(session.npub);
    const groupMap = new Map<number, string>();

    // Add personal tasks
    const personalTasks = listTodos(session.npub);
    tasks.push(...personalTasks.map((t) => ({ ...t, group_name: null })));

    // Add tasks from each group the user belongs to
    for (const group of userGroups) {
      groupMap.set(group.id, group.name);
      const groupTasks = listGroupTodos(group.id);
      tasks.push(...groupTasks.map((t) => ({ ...t, group_name: group.name })));
    }
  } else if (groupId) {
    const gid = Number(groupId);
    if (Number.isInteger(gid) && gid > 0) {
      const group = getGroup(gid);
      const groupTasks = listGroupTodos(gid);
      tasks = groupTasks.map((t) => ({ ...t, group_name: group?.name ?? null }));
    }
  } else {
    // Search user's personal tasks
    const personalTasks = listTodos(session.npub);
    tasks = personalTasks.map((t) => ({ ...t, group_name: null }));
  }

  // Filter by query if provided
  if (query) {
    tasks = tasks.filter(
      (t) => t.title.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
    );
  }

  // Limit results
  tasks = tasks.slice(0, limit);

  return jsonSuccess({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      priority: t.priority,
      group_id: t.group_id,
      group_name: t.group_name,
    })),
  });
}

/**
 * POST /api/tasks/:todoId/crm-links - Link an existing task to a CRM entity
 */
export async function handleLinkTaskToCrm(req: Request, session: Session | null, todoId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await req.json();
    const contactId = body.contact_id ? Number(body.contact_id) : undefined;
    const companyId = body.company_id ? Number(body.company_id) : undefined;
    const activityId = body.activity_id ? Number(body.activity_id) : undefined;
    const opportunityId = body.opportunity_id ? Number(body.opportunity_id) : undefined;

    if (!contactId && !companyId && !activityId && !opportunityId) {
      return jsonError("At least one CRM entity ID is required", 400);
    }

    // Verify the task exists
    const todo = getTodoById(todoId);
    if (!todo) return jsonError("Task not found", 404);

    // Check permission to link to this task
    if (todo.group_id) {
      if (!canManageGroupTodo(session.npub, todo.group_id)) {
        return jsonError("Forbidden", 403);
      }
    } else if (todo.owner !== session.npub) {
      return jsonError("Forbidden", 403);
    }

    // Create the link
    const link = linkTaskToCrm(todoId, { contactId, companyId, activityId, opportunityId }, session.npub);
    if (!link) {
      return jsonError("Failed to create link", 500);
    }

    return jsonSuccess({ success: true, link });
  } catch (_err) {
    return jsonError("Invalid request body", 400);
  }
}

/**
 * DELETE /api/tasks/:todoId/crm-links/:linkId - Unlink a task from a CRM entity
 */
export function handleUnlinkTaskFromCrm(session: Session | null, todoId: number, linkId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  // Verify the task exists
  const todo = getTodoById(todoId);
  if (!todo) return jsonError("Task not found", 404);

  // Check permission
  const canUnlink =
    todo.owner === session.npub ||
    (todo.group_id && canManageGroupTodo(session.npub, todo.group_id));

  if (!canUnlink) return jsonError("Forbidden", 403);

  unlinkTaskFromCrm(linkId);
  return jsonSuccess({ success: true });
}

/**
 * GET /api/tasks/:todoId/crm-links - Get CRM links for a task
 */
export function handleGetTaskCrmLinks(session: Session | null, todoId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const todo = getTodoById(todoId);
  if (!todo) return jsonError("Task not found", 404);

  const links = getCrmLinksForTask(todoId);
  return jsonSuccess({ links });
}

/**
 * GET /api/tasks/:todoId/all-links - Get all links (CRM + threads) for a task
 */
export function handleGetTaskAllLinks(session: Session | null, todoId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const todo = getTodoById(todoId);
  if (!todo) return jsonError("Task not found", 404);

  // Get CRM links with entity details
  const crmLinks = getCrmLinksWithDetails(todoId);

  // Get thread links
  const threadLinks = getThreadsForTask(todoId);

  return jsonSuccess({
    crm_links: crmLinks,
    thread_links: threadLinks,
  });
}

/**
 * GET /api/crm/contacts/:id/tasks - Get tasks linked to a contact
 */
export function handleGetContactTasks(session: Session | null, contactId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const contact = getCrmContact(contactId);
  if (!contact) return jsonError("Contact not found", 404);

  const tasks = getTasksForContact(contactId);
  return jsonSuccess({ tasks });
}

/**
 * GET /api/crm/companies/:id/tasks - Get tasks linked to a company
 */
export function handleGetCompanyTasks(session: Session | null, companyId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const company = getCrmCompany(companyId);
  if (!company) return jsonError("Company not found", 404);

  const tasks = getTasksForCompany(companyId);
  return jsonSuccess({ tasks });
}

/**
 * GET /api/crm/activities/:id/tasks - Get tasks linked to an activity
 */
export function handleGetActivityTasks(session: Session | null, activityId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const activity = getCrmActivity(activityId);
  if (!activity) return jsonError("Activity not found", 404);

  const tasks = getTasksForActivity(activityId);
  return jsonSuccess({ tasks });
}

/**
 * GET /api/crm/opportunities/:id/tasks - Get tasks linked to an opportunity
 */
export function handleGetOpportunityTasks(session: Session | null, opportunityId: number) {
  if (!session) return jsonError("Unauthorized", 401);

  const opportunity = getCrmOpportunity(opportunityId);
  if (!opportunity) return jsonError("Opportunity not found", 404);

  const tasks = getTasksForOpportunity(opportunityId);
  return jsonSuccess({ tasks });
}
