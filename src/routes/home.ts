import { getGroup, getGroupsForUser } from "../db";
import { renderHomePage } from "../render/home";
import { renderLandingPage } from "../render/landing";
import { canManageGroupTodo, listOwnerTodos, listTodosForGroup } from "../services/todos";

import type { Group } from "../db";
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

export function handleTodos(url: URL, session: Session | null) {
  const tagsParam = url.searchParams.get("tags");
  const filterTags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const showArchive = url.searchParams.get("archive") === "1";

  // Parse group context
  const groupParam = url.searchParams.get("group");
  const groupId = groupParam ? Number(groupParam) : null;

  let todos: ReturnType<typeof listOwnerTodos> = [];
  let userGroups: Group[] = [];
  let selectedGroup: Group | null = null;
  let canManage = true; // default for personal todos

  if (session) {
    // Get user's groups for the dropdown
    userGroups = getGroupsForUser(session.npub);

    if (groupId && Number.isInteger(groupId) && groupId > 0) {
      // Viewing group todos
      selectedGroup = getGroup(groupId) ?? null;
      if (selectedGroup) {
        todos = listTodosForGroup(groupId);
        canManage = canManageGroupTodo(session.npub, groupId);
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
  });
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
