import { isAdmin } from "../config";
import { getTeamBySlug, getUserSettings, isUserTeamMember, setUserSetting, deleteUserSetting } from "../master-db";
import { renderAppSettingsPage } from "../render/app-settings";
import { renderPersonalSettingsPage } from "../render/personal-settings";
import { renderTeamConfigPage } from "../render/team-settings";

import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

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

// ============================================================================
// User Settings API (per-individual key-value)
// ============================================================================

/**
 * GET /api/user-settings - Get all settings for the authenticated user
 */
export function handleGetUserSettings(session: Session | null) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: jsonHeaders });
  }

  const settings = getUserSettings(session.npub);
  return new Response(JSON.stringify({ settings }), { status: 200, headers: jsonHeaders });
}

/**
 * PUT /api/user-settings - Update user settings
 * Body: { settings: { key: value, ... } }
 * Set a key to null or "" to delete it.
 */
export async function handleUpdateUserSettings(req: Request, session: Session | null) {
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: jsonHeaders });
  }

  try {
    const body = await req.json();
    const updates = body.settings;

    if (!updates || typeof updates !== "object") {
      return new Response(JSON.stringify({ error: "Invalid settings payload" }), { status: 400, headers: jsonHeaders });
    }

    // Whitelist of allowed setting keys
    const allowedKeys = ["wingmen_url", "wingman_npub"];

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.includes(key)) continue;

      if (value === null || value === "") {
        deleteUserSetting(session.npub, key);
      } else {
        setUserSetting(session.npub, key, String(value));
      }
    }

    // Return updated settings
    const settings = getUserSettings(session.npub);
    return new Response(JSON.stringify({ settings }), { status: 200, headers: jsonHeaders });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: jsonHeaders });
  }
}
