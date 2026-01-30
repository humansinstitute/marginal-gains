import { isAdmin } from "../config";
import {
  addChannelGroup,
  addGroupMember,
  createGroup,
  deleteGroup,
  getChannel,
  getEncryptedChannelsForGroup,
  getGroup,
  getGroupByName,
  handleGroupMemberRemoval,
  handleGroupRemovedFromChannel,
  listChannelGroups,
  listGroupMembers,
  listGroups,
  removeChannelGroup,
  removeGroupMember,
  updateGroup,
} from "../db";
import { jsonResponse, unauthorized } from "../http";

import type { Session } from "../types";

function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

function requireAdmin(session: Session | null): Response | null {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Admin access required");
  return null;
}

// List all groups (admin only)
export function handleListGroups(session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;

  const groups = listGroups();
  return jsonResponse(groups);
}

// Get a specific group (admin only)
export function handleGetGroup(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const group = getGroup(id);
  if (!group) {
    return jsonResponse({ error: "Group not found" }, 404);
  }
  return jsonResponse(group);
}

// Create a new group (admin only)
export async function handleCreateGroup(req: Request, session: Session | null) {
  const error = requireAdmin(session);
  if (error) return error;

  const body = await req.json();
  const { name, description } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "_");

  // Check if group name already exists
  const existing = getGroupByName(normalizedName);
  if (existing) {
    return jsonResponse({ error: "Group name already exists" }, 409);
  }

  const group = createGroup(normalizedName, description?.trim() || "", session!.npub);
  if (!group) {
    return jsonResponse({ error: "Failed to create group" }, 500);
  }

  return jsonResponse(group, 201);
}

// Update a group (admin only)
export async function handleUpdateGroup(req: Request, session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getGroup(id);
  if (!existing) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  const body = await req.json();
  const { name, description } = body;

  const normalizedName = name?.trim().toLowerCase().replace(/\s+/g, "_") || existing.name;

  // Check if new name conflicts with another group
  if (normalizedName !== existing.name) {
    const conflict = getGroupByName(normalizedName);
    if (conflict) {
      return jsonResponse({ error: "Group name already exists" }, 409);
    }
  }

  const group = updateGroup(id, normalizedName, description?.trim() ?? existing.description);
  return jsonResponse(group);
}

// Delete a group (admin only)
export function handleDeleteGroup(session: Session | null, id: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const existing = getGroup(id);
  if (!existing) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  deleteGroup(id);
  return jsonResponse({ success: true });
}

// List members of a group (admin only)
export function handleListGroupMembers(session: Session | null, groupId: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const group = getGroup(groupId);
  if (!group) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  const members = listGroupMembers(groupId);
  return jsonResponse({ members });
}

// Add members to a group (admin only)
export async function handleAddGroupMembers(req: Request, session: Session | null, groupId: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const group = getGroup(groupId);
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
    const result = addGroupMember(groupId, npub);
    if (result) added.push(npub);
  }

  // Check for encrypted channels that may need key distribution
  const encryptedChannels = getEncryptedChannelsForGroup(groupId);
  const encryptedChannelsNeedingKeys = encryptedChannels.map((c) => ({ id: c.id, name: c.name }));

  return jsonResponse({
    added,
    group_id: groupId,
    encryptedChannelsNeedingKeys,
  });
}

// Remove a member from a group (admin only)
export function handleRemoveGroupMember(session: Session | null, groupId: number, npub: string) {
  const error = requireAdmin(session);
  if (error) return error;

  const group = getGroup(groupId);
  if (!group) {
    return jsonResponse({ error: "Group not found" }, 404);
  }

  // Remove member from group first
  removeGroupMember(groupId, npub);

  // Handle encryption key revocation AFTER removing member
  // so the access check correctly excludes this group
  handleGroupMemberRemoval(groupId, npub);

  return jsonResponse({ success: true });
}

// List groups assigned to a channel (admin only)
export function handleListChannelGroups(session: Session | null, channelId: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const groups = listChannelGroups(channelId);
  return jsonResponse(groups);
}

// Assign groups to a channel (admin only)
export async function handleAddChannelGroups(req: Request, session: Session | null, channelId: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Only allow assigning groups to private channels
  if (channel.is_public === 1) {
    return jsonResponse({ error: "Cannot assign groups to public channels" }, 400);
  }

  const body = await req.json();
  const { groupIds } = body;

  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return jsonResponse({ error: "groupIds array is required" }, 400);
  }

  const added: number[] = [];
  for (const groupId of groupIds) {
    if (typeof groupId !== "number") continue;
    const group = getGroup(groupId);
    if (!group) continue;
    const result = addChannelGroup(channelId, groupId);
    if (result) added.push(groupId);
  }

  // If channel is encrypted, new group members need keys
  const needsKeyDistribution = channel.encrypted === 1 && added.length > 0;

  return jsonResponse({
    added,
    channel_id: channelId,
    needsKeyDistribution,
    channelName: needsKeyDistribution ? channel.name : undefined,
  });
}

// Remove a group from a channel (admin only)
export function handleRemoveChannelGroup(session: Session | null, channelId: number, groupId: number) {
  const error = requireAdmin(session);
  if (error) return error;

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Remove group from channel first
  removeChannelGroup(channelId, groupId);

  // Handle encryption key revocation AFTER removing group
  // so the access check correctly excludes this group
  handleGroupRemovedFromChannel(channelId, groupId);

  return jsonResponse({ success: true });
}
