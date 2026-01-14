/**
 * Team-scoped chat route handlers
 *
 * These handlers are the team-aware versions of the chat routes.
 * They use the RequestContext pattern to access the team database.
 */

import { getWingmanIdentity, isAdmin } from "../config";
import { createTeamRouteContext } from "../context";
import { jsonResponse } from "../http";
import { renderChatPage } from "../render/chat";
import { broadcast } from "../services/events";
import { TeamDatabase } from "../team-db";

import type { TeamContextResult } from "../context";
import type { DeepLink, Session } from "../types";

// ============================================================================
// Helpers
// ============================================================================

function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

/**
 * Helper to get team context or return error response
 */
function requireTeamContext(
  session: Session | null,
  teamSlug: string
): TeamContextResult {
  return createTeamRouteContext(session, teamSlug);
}

// ============================================================================
// Page Handlers
// ============================================================================

export function handleTeamChatPage(
  session: Session | null,
  teamSlug: string,
  deepLink?: DeepLink
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  // Check if community encryption is active and user needs onboarding
  let needsOnboarding = false;
  const bootstrapped = db.isCommunityBootstrapped();
  if (bootstrapped) {
    const hasCommunityKey = !!db.getCommunityKey(ctx.session.pubkey);
    needsOnboarding = !hasCommunityKey;
  }

  const page = renderChatPage(ctx.session, deepLink, needsOnboarding, teamSlug);
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ============================================================================
// API Handlers
// ============================================================================

export function handleTeamListChannels(
  session: Session | null,
  teamSlug: string
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  // Admins see all channels, regular users see only visible ones
  // But personal channels (owner_npub set) are ALWAYS filtered to only show the current user's
  const allChannels = isAdmin(ctx.session.npub)
    ? db.listAllChannels()
    : db.listVisibleChannels(ctx.session.npub);

  // Filter out ALL personal channels from the channels list
  // Personal channels are returned separately as `personalChannel`
  const rawChannels = allChannels.filter((c) => !c.owner_npub);

  // Check Wingman access for each channel
  const wingman = getWingmanIdentity();
  const wingmanHasCommunityKey = wingman
    ? !!db.getCommunityKey(wingman.pubkey)
    : false;
  const communityBootstrapped = db.isCommunityBootstrapped();

  const channels = rawChannels.map((channel) => {
    let hasWingmanAccess = false;

    if (wingman) {
      if (channel.is_public === 1) {
        hasWingmanAccess = !communityBootstrapped || wingmanHasCommunityKey;
      } else {
        hasWingmanAccess = db.userHasChannelAccessViaGroups(
          channel.id,
          wingman.npub
        );
      }
    }

    return { ...channel, hasWingmanAccess };
  });

  // Get DM channels for this user
  const dmChannels = db.listDmChannels(ctx.session.npub);

  // Get or create personal "Note to self" channel
  const personalChannel = db.getOrCreatePersonalChannel(ctx.session.npub);

  // Get unread counts for all channels
  const unreadCounts = db.getUnreadCounts(ctx.session.npub);

  return jsonResponse({
    channels,
    dmChannels,
    personalChannel,
    unreadState: Object.fromEntries(
      unreadCounts.map((u) => [
        u.channel_id,
        { unread: u.unread_count, mentions: u.mention_count },
      ])
    ),
  });
}

export function handleTeamGetChannel(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access for private channels (admins can see all)
  if (channel.is_public === 0 && !isAdmin(ctx.session.npub)) {
    if (!db.canUserAccessChannel(channelId, ctx.session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  return jsonResponse(channel);
}

export function handleTeamGetMessages(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access for private channels
  if (channel.is_public === 0 && !isAdmin(ctx.session.npub)) {
    if (!db.canUserAccessChannel(channelId, ctx.session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  const messages = db.getChannelMessages(channelId);
  console.log(`[TeamChat] GetMessages: team=${teamSlug}, channel=${channelId}, user=${ctx.session.npub.slice(0, 15)}, messageCount=${messages.length}`);
  return jsonResponse(messages);
}

export async function handleTeamSendMessage(
  req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access for private channels
  if (channel.is_public === 0 && !isAdmin(ctx.session.npub)) {
    if (!db.canUserAccessChannel(channelId, ctx.session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  const body = await req.json();
  const { content, parentId, encrypted } = body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return jsonResponse({ error: "Message content is required" }, 400);
  }

  let message;
  if (encrypted) {
    // Calculate threadRootId from parent if replying
    let threadRootId: number | null = null;
    const parentIdNum = parentId ? Number(parentId) : null;
    if (parentIdNum) {
      const parent = db.getMessage(parentIdNum);
      if (parent) {
        threadRootId = parent.thread_root_id ?? parent.id;
      }
    }
    message = db.createEncryptedMessage(
      channelId,
      ctx.session.npub,
      content,
      threadRootId,
      parentIdNum,
      null, // quotedMessageId
      1     // keyVersion
    );
  } else if (parentId) {
    message = db.createMessage(channelId, ctx.session.npub, content, parentId);
  } else {
    message = db.createMessage(channelId, ctx.session.npub, content);
  }

  if (!message) {
    return jsonResponse({ error: "Failed to send message" }, 500);
  }

  console.log(`[TeamChat] SendMessage: team=${teamSlug}, channel=${channelId}, messageId=${message.id}, encrypted=${encrypted || false}`);

  // Broadcast to team namespace
  broadcast(teamSlug, ctx.teamDb, {
    type: "message:new",
    data: { ...message, channelId },
    channelId,
  });

  return jsonResponse(message, 201);
}

export async function handleTeamCreateChannel(
  req: Request,
  session: Session | null,
  teamSlug: string
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const body = await req.json();
  const { name, displayName, description, isPublic, groupId } = body;

  if (!name || typeof name !== "string") {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  const channelIsPublic = isPublic !== false;
  if (!channelIsPublic && !isAdmin(ctx.session.npub)) {
    return forbidden("Only admins can create private channels");
  }

  const channelEncrypted = !channelIsPublic;
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "-");

  // Use createEncryptedChannel for private channels to properly set encrypted flag
  const channel = channelEncrypted
    ? db.createEncryptedChannel(
        normalizedName,
        displayName?.trim() || normalizedName,
        description?.trim() || "",
        ctx.session.npub,
        channelIsPublic
      )
    : db.createChannel(
        normalizedName,
        displayName?.trim() || normalizedName,
        description?.trim() || "",
        ctx.session.npub,
        channelIsPublic
      );

  if (!channel) {
    return jsonResponse({ error: "Channel name already exists" }, 409);
  }

  // If a group was specified for a private channel, assign it
  if (!channelIsPublic && groupId && typeof groupId === "number") {
    db.addChannelGroup(channel.id, groupId);
  }

  // Broadcast new channel event to team
  broadcast(teamSlug, ctx.teamDb, {
    type: "channel:new",
    data: {
      id: channel.id,
      name: channel.name,
      displayName: channel.display_name,
      description: channel.description,
      isPublic: channel.is_public === 1,
    },
  });

  return jsonResponse(channel, 201);
}

export async function handleTeamCreateDm(
  req: Request,
  session: Session | null,
  teamSlug: string
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const body = await req.json();
  const { targetNpub, displayName } = body;

  if (!targetNpub || typeof targetNpub !== "string") {
    return jsonResponse({ error: "targetNpub is required" }, 400);
  }

  if (targetNpub === ctx.session.npub) {
    return jsonResponse({ error: "Cannot create DM with yourself" }, 400);
  }

  const dmDisplayName = displayName || "DM";
  const channel = db.getOrCreateDmChannel(
    ctx.session.npub,
    targetNpub,
    dmDisplayName
  );

  if (!channel) {
    return jsonResponse({ error: "Failed to create DM channel" }, 500);
  }

  // Broadcast DM channel creation to both participants
  broadcast(teamSlug, ctx.teamDb, {
    type: "dm:new",
    data: {
      id: channel.id,
      name: channel.name,
      displayName: channel.display_name,
      description: channel.description,
    },
    recipientNpubs: [ctx.session.npub, targetNpub],
  });

  return jsonResponse(channel, 201);
}

export function handleTeamListUsers(
  session: Session | null,
  teamSlug: string
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const users = db.listUsers();
  return jsonResponse(users);
}

export function handleTeamGetMe(
  session: Session | null,
  teamSlug: string
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  return jsonResponse({
    npub: ctx.session.npub,
    pubkey: ctx.session.pubkey,
    isAdmin: isAdmin(ctx.session.npub),
  });
}

export async function handleTeamUpdateUser(
  req: Request,
  session: Session | null,
  teamSlug: string
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const body = await req.json();
  const { npub, pubkey, displayName, name, about, picture, nip05 } = body;

  if (!npub || !pubkey) {
    return jsonResponse({ error: "npub and pubkey are required" }, 400);
  }

  const user = db.upsertUser({
    npub,
    pubkey,
    displayName: displayName || null,
    name: name || null,
    about: about || null,
    picture: picture || null,
    nip05: nip05 || null,
    lastLogin: npub === ctx.session.npub ? new Date().toISOString() : null,
  });

  return jsonResponse(user);
}

export function handleTeamMarkChannelRead(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access
  if (
    !db.canUserAccessChannel(channelId, ctx.session.npub) &&
    !isAdmin(ctx.session.npub)
  ) {
    return forbidden("Access denied");
  }

  const latestMessageId = db.getLatestMessageId(channelId);
  db.updateChannelReadState(ctx.session.npub, channelId, latestMessageId);

  return jsonResponse({ success: true, lastReadMessageId: latestMessageId });
}

export function handleTeamDeleteMessage(
  session: Session | null,
  teamSlug: string,
  messageId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const message = db.getMessage(messageId);
  if (!message) {
    return jsonResponse({ error: "Message not found" }, 404);
  }

  const canDelete =
    message.author === ctx.session.npub || isAdmin(ctx.session.npub);
  if (!canDelete) {
    return forbidden("You can only delete your own messages");
  }

  db.deleteMessage(messageId);

  broadcast(teamSlug, ctx.teamDb, {
    type: "message:delete",
    data: { messageId, channelId: message.channel_id },
    channelId: message.channel_id,
  });

  return jsonResponse({ success: true });
}

export function handleTeamDeleteChannel(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  if (!isAdmin(ctx.session.npub)) {
    return forbidden("Only admins can delete channels");
  }

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  if (channel.owner_npub) {
    return forbidden("Cannot delete personal channels");
  }

  broadcast(teamSlug, ctx.teamDb, {
    type: "channel:delete",
    data: { id: channelId },
    channelId,
  });

  db.deleteChannel(channelId);
  return jsonResponse({ success: true });
}

export async function handleTeamUpdateChannel(
  req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const existing = db.getChannel(channelId);
  if (!existing) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const userIsAdmin = isAdmin(ctx.session.npub);
  if (existing.is_public === 0 && !userIsAdmin) {
    return forbidden("Only admins can modify private channels");
  }

  const body = await req.json();
  const { displayName, description, isPublic } = body;

  let newIsPublic = existing.is_public === 1;
  if (isPublic !== undefined && userIsAdmin) {
    newIsPublic = isPublic;
  }

  const channel = db.updateChannel(
    channelId,
    displayName?.trim() || existing.display_name,
    description?.trim() ?? existing.description,
    newIsPublic
  );

  if (channel) {
    broadcast(teamSlug, ctx.teamDb, {
      type: "channel:update",
      data: {
        id: channel.id,
        name: channel.name,
        displayName: channel.display_name,
        description: channel.description,
        isPublic: channel.is_public === 1,
      },
      channelId,
    });
  }

  return jsonResponse(channel);
}

// ============================================================================
// Channel Key Management (E2E Encryption)
// ============================================================================

export function handleTeamGetChannelKey(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  if (channel.is_public === 0 && !isAdmin(ctx.session.npub)) {
    if (!db.canUserAccessChannel(channelId, ctx.session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  const key = db.getUserChannelKey(ctx.session.pubkey, channelId);
  if (!key) {
    return jsonResponse({ error: "No key found for this channel" }, 404);
  }

  return jsonResponse({
    encrypted_key: key.encrypted_key,
    key_version: key.key_version,
    created_at: key.created_at,
  });
}

export async function handleTeamStoreChannelKey(
  req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const isOwner = channel.creator === ctx.session.npub;
  const userIsAdmin = isAdmin(ctx.session.npub);

  const body = await req.json();
  const { userPubkey, encryptedKey, keyVersion } = body;

  if (!userPubkey || !encryptedKey) {
    return jsonResponse(
      { error: "userPubkey and encryptedKey are required" },
      400
    );
  }

  if (userPubkey !== ctx.session.pubkey && !isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can store keys for other users");
  }

  const version = keyVersion ?? db.getLatestKeyVersion(channelId) + 1;
  const stored = db.storeUserChannelKey(
    userPubkey,
    channelId,
    encryptedKey,
    version
  );

  if (!stored) {
    return jsonResponse({ error: "Failed to store key" }, 500);
  }

  return jsonResponse(stored, 201);
}

export async function handleTeamStoreChannelKeysBatch(
  req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const isOwner = channel.creator === ctx.session.npub;
  const userIsAdmin = isAdmin(ctx.session.npub);

  if (!isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can store keys for other users");
  }

  const body = await req.json();
  const { keys, keyVersion, setEncrypted } = body;

  if (!Array.isArray(keys) || keys.length === 0) {
    return jsonResponse({ error: "keys array is required" }, 400);
  }

  const version = keyVersion ?? db.getLatestKeyVersion(channelId) + 1;
  const results: Array<{ userPubkey: string; success: boolean }> = [];

  for (const keyEntry of keys) {
    const { userPubkey, encryptedKey } = keyEntry;
    if (!userPubkey || !encryptedKey) {
      results.push({ userPubkey: userPubkey || "unknown", success: false });
      continue;
    }

    const stored = db.storeUserChannelKey(
      userPubkey,
      channelId,
      encryptedKey,
      version
    );
    results.push({ userPubkey, success: !!stored });
  }

  if (setEncrypted && !channel.encrypted) {
    db.setChannelEncrypted(channelId);
  }

  return jsonResponse({ results, keyVersion: version }, 201);
}

export function handleTeamGetChannelKeysAll(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const isOwner = channel.creator === ctx.session.npub;
  const userIsAdmin = isAdmin(ctx.session.npub);

  if (!isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can view all keys");
  }

  const keys = db.getChannelKeys(channelId);
  return jsonResponse({ keys });
}

export function handleTeamGetPendingKeyMembers(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const isOwner = channel.creator === ctx.session.npub;
  const userIsAdmin = isAdmin(ctx.session.npub);

  if (!isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can view pending key members");
  }

  const pendingNpubs = db.getChannelMembersWithoutKeys(channelId);
  const pendingMembers = pendingNpubs
    .map((npub) => {
      const user = db.getUserByNpub(npub);
      return {
        npub,
        pubkey: user?.pubkey || null,
        displayName: user?.display_name || null,
      };
    })
    .filter((m) => m.pubkey);

  return jsonResponse({
    pendingMembers,
    channelEncrypted: channel.encrypted === 1,
  });
}

export function handleTeamListChannelGroups(
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const groups = db.listChannelGroups(channelId);
  return jsonResponse(groups);
}

export async function handleTeamAddChannelGroups(
  req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  if (!isAdmin(ctx.session.npub)) {
    return forbidden("Only admins can manage channel groups");
  }

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  const body = await req.json();
  const { groupIds } = body;

  if (!Array.isArray(groupIds)) {
    return jsonResponse({ error: "groupIds array is required" }, 400);
  }

  for (const groupId of groupIds) {
    db.addChannelGroup(channelId, groupId);
  }

  return jsonResponse({ success: true });
}

export function handleTeamRemoveChannelGroup(
  session: Session | null,
  teamSlug: string,
  channelId: number,
  groupId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  if (!isAdmin(ctx.session.npub)) {
    return forbidden("Only admins can manage channel groups");
  }

  db.removeChannelGroup(channelId, groupId);
  return jsonResponse({ success: true });
}
