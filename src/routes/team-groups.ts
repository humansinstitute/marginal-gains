/**
 * Team-scoped Group Routes
 *
 * These routes handle group management within a team context.
 * Groups are stored in the team's database, not the main database.
 */

import { createTeamRouteContext } from "../context";
import { jsonResponse } from "../http";
import { TeamDatabase } from "../team-db";

import type { Session } from "../types";

// Helper to create and validate team context
function requireTeamContext(session: Session | null, teamSlug: string, returnPath?: string) {
  return createTeamRouteContext(session, teamSlug, returnPath);
}

// List all groups in the team
export function handleTeamListGroups(session: Session | null, teamSlug: string) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const groups = db.listGroups();
  return jsonResponse(groups);
}

// Get a specific group
export function handleTeamGetGroup(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const group = db.getGroup(id);
  if (!group) {
    return jsonResponse({ error: "Group not found" }, 404);
  }
  return jsonResponse(group);
}

// Create a new group
export async function handleTeamCreateGroup(
  req: Request,
  session: Session | null,
  teamSlug: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const body = await req.json();
  const { name, description } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "_");

  const db = new TeamDatabase(result.ctx.teamDb);

  // Check if group name already exists
  const existing = db.getGroupByName(normalizedName);
  if (existing) {
    return jsonResponse({ error: "Group name already exists" }, 409);
  }

  const group = db.createGroup(normalizedName, description?.trim() || "", result.ctx.session!.npub);
  if (!group) {
    return jsonResponse({ error: "Failed to create group" }, 500);
  }

  return jsonResponse(group, 201);
}

// Update a group
export async function handleTeamUpdateGroup(
  req: Request,
  session: Session | null,
  teamSlug: string,
  id: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getGroup(id);
  if (!existing) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  const body = await req.json();
  const { name, description } = body;

  const normalizedName = name?.trim().toLowerCase().replace(/\s+/g, "_") || existing.name;

  // Check if new name conflicts with another group
  if (normalizedName !== existing.name) {
    const conflict = db.getGroupByName(normalizedName);
    if (conflict) {
      return jsonResponse({ error: "Group name already exists" }, 409);
    }
  }

  const group = db.updateGroup(id, normalizedName, description?.trim() ?? existing.description);
  return jsonResponse(group);
}

// Delete a group
export function handleTeamDeleteGroup(session: Session | null, teamSlug: string, id: number) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const existing = db.getGroup(id);
  if (!existing) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  db.deleteGroup(id);
  return jsonResponse({ success: true });
}

// List members of a group
export function handleTeamListGroupMembers(
  session: Session | null,
  teamSlug: string,
  groupId: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const group = db.getGroup(groupId);
  if (!group) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  const members = db.listGroupMembersWithProfile(groupId);
  return jsonResponse({ members });
}

// Add members to a group
export async function handleTeamAddGroupMembers(
  req: Request,
  session: Session | null,
  teamSlug: string,
  groupId: number
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const group = db.getGroup(groupId);
  if (!group) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  const body = await req.json();
  const { npubs } = body;

  if (!Array.isArray(npubs) || npubs.length === 0) {
    return jsonResponse({ error: "npubs array is required" }, 400);
  }

  // Validate all npubs
  const validNpubs = npubs.filter((n) => typeof n === "string" && n.startsWith("npub"));
  if (validNpubs.length === 0) {
    return jsonResponse({ error: "No valid npubs provided" }, 400);
  }

  const added: string[] = [];
  for (const npub of validNpubs) {
    db.addGroupMember(groupId, npub);
    added.push(npub);
  }

  // Check for encrypted channels that may need key distribution
  const encryptedChannels = db.getEncryptedChannelsForGroup(groupId);
  const encryptedChannelsNeedingKeys = encryptedChannels.map((c) => ({ id: c.id, name: c.name }));

  return jsonResponse({
    added,
    group_id: groupId,
    encryptedChannelsNeedingKeys,
  });
}

// Remove a member from a group
export function handleTeamRemoveGroupMember(
  session: Session | null,
  teamSlug: string,
  groupId: number,
  npub: string
) {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const db = new TeamDatabase(result.ctx.teamDb);
  const group = db.getGroup(groupId);
  if (!group) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  // Remove member from group
  db.removeGroupMember(groupId, npub);

  // TODO: Handle encryption key revocation when encryption is implemented for teams

  return jsonResponse({ success: true });
}
