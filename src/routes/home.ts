import { getGroup, getGroupsForUser, listGroupMembers } from "../db";
import { renderHomePage } from "../render/home";
import { renderLandingPage } from "../render/landing";
import { canManageGroupTodo, listAllUserAssignedTodos, listOwnerTodos, listTodosForGroup } from "../services/todos";

import type { Group, GroupMember } from "../db";
import type { Session } from "../types";

export function handleHome(session: Session | null) {
  if (session) {
    // If user has a team context, go directly to that team's chat
    if (session.currentTeamSlug) {
      return new Response(null, {
        status: 302,
        headers: { Location: `/t/${session.currentTeamSlug}/chat` },
      });
    }
    // Otherwise go to teams page to select one (will auto-redirect if user has one team)
    return new Response(null, {
      status: 302,
      headers: { Location: "/teams" },
    });
  }
  const page = renderLandingPage();
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export type ViewMode = "kanban" | "list";

export function handleTodos(url: URL, session: Session | null, viewMode: ViewMode = "kanban") {
  const tagsParam = url.searchParams.get("tags");
  const filterTags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const showArchive = url.searchParams.get("archive") === "1";

  // Parse group context
  const groupParam = url.searchParams.get("group");
  const groupId = groupParam ? Number(groupParam) : null;

  // Parse view mode (all = all my tasks across boards)
  const viewParam = url.searchParams.get("view");
  const isAllTasksView = viewParam === "all";

  // Parse "my tasks" filter for group boards
  const mineFilter = url.searchParams.get("mine") === "1";

  let todos: ReturnType<typeof listOwnerTodos> = [];
  let userGroups: Group[] = [];
  let selectedGroup: Group | null = null;
  let canManage = true; // default for personal todos
  let groupMembers: Array<GroupMember & { display_name: string | null; picture: string | null }> = [];

  if (session) {
    // Get user's groups for the dropdown
    userGroups = getGroupsForUser(session.npub);

    if (isAllTasksView) {
      // "All My Tasks" view - aggregate tasks assigned to user across all boards
      todos = listAllUserAssignedTodos(session.npub, filterTags);
      canManage = true; // User can manage their own assigned tasks
    } else if (groupId && Number.isInteger(groupId) && groupId > 0) {
      // Viewing group todos
      selectedGroup = getGroup(groupId) ?? null;
      if (selectedGroup) {
        // Apply "my tasks" filter if set
        const assigneeFilter = mineFilter ? session.npub : undefined;
        todos = listTodosForGroup(groupId, filterTags, assigneeFilter);
        canManage = canManageGroupTodo(session.npub, groupId);
        // Get group members for assignee dropdown
        groupMembers = listGroupMembers(groupId);
      }
    } else {
      // Viewing personal todos
      todos = listOwnerTodos(session.npub);
    }
  }

  const page = renderHomePage({
    showArchive,
    session,
    filterTags,
    todos,
    userGroups,
    selectedGroup,
    canManage,
    isAllTasksView,
    mineFilter,
    groupMembers,
    viewMode,
  });
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function handleTodosRedirect(url: URL) {
  // Redirect /todo to /todo/kanban, preserving query params
  const newUrl = new URL(url);
  newUrl.pathname = "/todo/kanban";
  return new Response(null, {
    status: 302,
    headers: { Location: newUrl.pathname + newUrl.search },
  });
}
