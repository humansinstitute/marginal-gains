import { isAdmin } from "../config";
import { getTeamBySlug, isUserTeamMember } from "../master-db";
import { renderAppSettingsPage } from "../render/app-settings";
import { renderPersonalSettingsPage } from "../render/personal-settings";
import { renderTeamConfigPage } from "../render/team-settings";

import type { Session } from "../types";

/**
 * Personal Settings page - available to all authenticated users
 */
export function handlePersonalSettings(session: Session | null) {
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/?return=%2Fsettings" },
    });
  }

  const page = renderPersonalSettingsPage(session);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * App Settings page - admin only
 */
export function handleAppSettingsPage(session: Session | null) {
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/?return=%2Fadmin%2Fsettings" },
    });
  }

  if (!isAdmin(session.npub)) {
    return new Response("Forbidden", { status: 403 });
  }

  const page = renderAppSettingsPage(session);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Team Config page (Groups, Wingman settings)
 * Available to team members
 */
export function handleTeamConfigPage(session: Session | null, teamSlug: string) {
  if (!session) {
    const returnPath = encodeURIComponent(`/t/${teamSlug}/config`);
    return new Response(null, {
      status: 302,
      headers: { Location: `/?return=${returnPath}` },
    });
  }

  // Get team by slug
  const team = getTeamBySlug(teamSlug);
  if (!team) {
    return new Response("Team not found", { status: 404 });
  }

  // Check if user is a member of this team
  if (!isUserTeamMember(team.id, session.npub)) {
    return new Response("Forbidden - not a team member", { status: 403 });
  }

  const page = renderTeamConfigPage(session, teamSlug);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Keep the old function for backwards compatibility during migration
export function handleSettings(session: Session | null) {
  return handlePersonalSettings(session);
}
