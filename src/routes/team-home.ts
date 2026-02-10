/**
 * Team Home page route handler
 *
 * Shows recent activities (mentions, DMs, task assignments/updates).
 */

import { createTeamRouteContext } from "../context";
import { renderTeamHomePage } from "../render/team-home";
import { TeamDatabase } from "../team-db";

import { getTeamBranding } from "./app-settings";

import type { Activity } from "../team-db";
import type { Session } from "../types";

export function handleTeamHomePage(
  session: Session | null,
  teamSlug: string
): Response {
  const result = createTeamRouteContext(session, teamSlug, `/t/${teamSlug}/home`);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const activities = db.listActivities(ctx.session.npub, 50);
  const unreadCount = db.getUnreadActivityCount(ctx.session.npub);
  const branding = getTeamBranding(teamSlug);

  // Build lookup maps for deep-linking
  const channelNames = buildChannelNameMap(db, activities);
  const todoGroups = buildTodoGroupMap(db, activities);

  const page = renderTeamHomePage({
    session: ctx.session,
    teamSlug,
    activities,
    unreadCount,
    branding,
    channelNames,
    todoGroups,
  });

  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Map channel_id → channel name (slug) for building chat deep links */
function buildChannelNameMap(db: TeamDatabase, activities: Activity[]): Map<number, string> {
  const channelIds = new Set<number>();
  for (const a of activities) {
    if (a.channel_id) channelIds.add(a.channel_id);
  }

  const map = new Map<number, string>();
  for (const id of channelIds) {
    const channel = db.getChannel(id);
    if (channel) map.set(id, channel.name);
  }
  return map;
}

/** Map todo_id → group_id for building task deep links */
function buildTodoGroupMap(db: TeamDatabase, activities: Activity[]): Map<number, number | null> {
  const todoIds = new Set<number>();
  for (const a of activities) {
    if (a.todo_id) todoIds.add(a.todo_id);
  }

  const map = new Map<number, number | null>();
  for (const id of todoIds) {
    const todo = db.getTodoById(id);
    if (todo) map.set(id, todo.group_id ?? null);
  }
  return map;
}
