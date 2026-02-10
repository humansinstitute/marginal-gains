import { getWingmanIdentity, isAdmin } from "../config";
import {
  addChannelGroup,
  canUserAccessChannel,
  deleteChannel,
  deleteMessage,
  getChannel,
  getChannelKeys,
  getChannelMembersWithoutKeys,
  getCommunityKey,
  getDmParticipants,
  getLatestKeyVersion,
  getLatestMessageId,
  getMessage,
  getMessageReactions,
  getMessagesReactions,
  getOrCreateDmChannel,
  getOrCreatePersonalChannel,
  getPinnedMessages,
  getUnreadCounts,
  getUserByNpub,
  getUserChannelKey,
  isCommunityBootstrapped,
  isMessagePinned,
  listAllChannels,
  listDmChannels,
  listUsers,
  listVisibleChannels,
  pinMessage,
  setChannelEncrypted,
  storeUserChannelKey,
  toggleReaction,
  unpinMessage,
  updateChannelReadState,
  upsertUser,
  userHasChannelAccessViaGroups,
} from "../db";
import { jsonResponse, unauthorized } from "../http";
import { renderChatPage } from "../render/chat";
import {
  createNewChannel,
  editChannel,
  getChannelById,
  getChannelMessages,
  replyToMessage,
  sendEncryptedMessage,
  sendMessage,
} from "../services/chat";
import { broadcastLegacy as broadcast } from "../services/events";
import { notifyChannelMessage } from "../services/push";
import { executeSlashCommands } from "../services/slashCommands";
import { parseMentionsFromBody } from "../utils/mentions";

import type { DeepLink, Session } from "../types";


function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

export function handleChatPage(session: Session | null, deepLink?: DeepLink) {
  // Check if community encryption is active and user needs onboarding
  let needsOnboarding = false;
  if (session) {
    const bootstrapped = isCommunityBootstrapped();
    if (bootstrapped) {
      const hasCommunityKey = !!getCommunityKey(session.pubkey);
      needsOnboarding = !hasCommunityKey;
    }
  }

  const page = renderChatPage(session, deepLink, needsOnboarding);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function handleListChannels(session: Session | null) {
  if (!session) return unauthorized();

  // Admins see all channels, regular users see only visible ones
  // But personal channels (owner_npub set) are ALWAYS filtered to only show the current user's
  const allChannels = isAdmin(session.npub)
    ? listAllChannels()
    : listVisibleChannels(session.npub);

  // Filter out ALL personal channels from the channels list
  // Personal channels are returned separately as `personalChannel`
  const rawChannels = allChannels.filter((c) => !c.owner_npub);

  // Check Wingman access for each channel
  const wingman = getWingmanIdentity();
  const wingmanHasCommunityKey = wingman ? !!getCommunityKey(wingman.pubkey) : false;
  const communityBootstrapped = isCommunityBootstrapped();

  const channels = rawChannels.map((channel) => {
    let hasWingmanAccess = false;

    if (wingman) {
      if (channel.is_public === 1) {
        // Public channels: Wingman has access if community encryption is not active
        // or if Wingman has the community key
        hasWingmanAccess = !communityBootstrapped || wingmanHasCommunityKey;
      } else {
        // Private channels: Wingman needs group membership
        hasWingmanAccess = userHasChannelAccessViaGroups(channel.id, wingman.npub);
      }
    }

    return { ...channel, hasWingmanAccess };
  });

  // Get DM channels for this user
  const dmChannels = listDmChannels(session.npub);

  // Get or create personal "Note to self" channel and append at end
  const personalChannel = getOrCreatePersonalChannel(session.npub);

  // Get unread counts for all channels
  const unreadCounts = getUnreadCounts(session.npub);

  return jsonResponse({
    channels,
    dmChannels,
    personalChannel,
    unreadState: Object.fromEntries(
      unreadCounts.map((u) => [u.channel_id, { unread: u.unread_count, mentions: u.mention_count }])
    ),
  });
}

export function handleGetChannel(session: Session | null, id: number) {
  if (!session) return unauthorized();

  const channel = getChannelById(id);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access for private channels (admins can see all)
  if (channel.is_public === 0 && !isAdmin(session.npub)) {
    if (!canUserAccessChannel(id, session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  return jsonResponse(channel);
}

export async function handleCreateChannel(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await req.json();
  const { name, displayName, description, isPublic, groupId } = body;

  if (!name || typeof name !== "string") {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  // Only admins can create private channels
  const channelIsPublic = isPublic !== false;
  if (!channelIsPublic && !isAdmin(session.npub)) {
    return forbidden("Only admins can create private channels");
  }

  // Private channels are always encrypted
  const channelEncrypted = !channelIsPublic;

  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "-");
  const channel = createNewChannel(
    normalizedName,
    displayName?.trim() || normalizedName,
    description?.trim() || "",
    session.npub,
    channelIsPublic,
    channelEncrypted
  );

  if (!channel) {
    return jsonResponse({ error: "Channel name already exists" }, 409);
  }

  // If a group was specified for a private channel, assign it
  if (!channelIsPublic && groupId && typeof groupId === "number") {
    addChannelGroup(channel.id, groupId);
  }

  // Broadcast new channel event
  broadcast({
    type: "channel:new",
    data: {
      id: channel.id,
      name: channel.name,
      displayName: channel.display_name,
      description: channel.description,
      isPublic: channel.is_public === 1,
    },
    // For private channels, we'd need to limit recipients to group members
    // For now, broadcast to all - client will filter based on access
  });

  return jsonResponse(channel, 201);
}

export async function handleUpdateChannel(req: Request, session: Session | null, id: number) {
  if (!session) return unauthorized();

  const existing = getChannelById(id);
  if (!existing) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Only admins can modify private channels or change public/private status
  const userIsAdmin = isAdmin(session.npub);
  if (existing.is_public === 0 && !userIsAdmin) {
    return forbidden("Only admins can modify private channels");
  }

  const body = await req.json();
  const { displayName, description, isPublic } = body;

  // Only admins can change public/private status
  let newIsPublic = existing.is_public === 1;
  if (isPublic !== undefined && userIsAdmin) {
    newIsPublic = isPublic;
  }

  const channel = editChannel(
    id,
    displayName?.trim() || existing.display_name,
    description?.trim() ?? existing.description,
    newIsPublic
  );

  // Broadcast channel update event
  if (channel) {
    broadcast({
      type: "channel:update",
      data: {
        id: channel.id,
        name: channel.name,
        displayName: channel.display_name,
        description: channel.description,
        isPublic: channel.is_public === 1,
      },
      channelId: id,
    });
  }

  return jsonResponse(channel);
}

export function handleDeleteChannel(session: Session | null, id: number) {
  if (!session) return unauthorized();

  // Only admins can delete channels
  if (!isAdmin(session.npub)) {
    return forbidden("Only admins can delete channels");
  }

  const existing = getChannelById(id);
  if (!existing) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Prevent deletion of personal channels (Note to self)
  if (existing.owner_npub) {
    return forbidden("Cannot delete personal channels");
  }

  // Broadcast before deleting so clients know to remove it
  broadcast({
    type: "channel:delete",
    data: { id },
    channelId: id,
  });

  deleteChannel(id);
  return jsonResponse({ success: true });
}

export function handleMarkChannelRead(session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannelById(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access
  if (!canUserAccessChannel(channelId, session.npub) && !isAdmin(session.npub)) {
    return forbidden("Access denied");
  }

  // Get the latest message ID for this channel
  const latestMessageId = getLatestMessageId(channelId);

  // Update the read state
  updateChannelReadState(session.npub, channelId, latestMessageId);

  return jsonResponse({ success: true, lastReadMessageId: latestMessageId });
}

export function handleGetMessages(session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannelById(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access for private channels (admins can see all)
  if (channel.is_public === 0 && !isAdmin(session.npub)) {
    if (!canUserAccessChannel(channelId, session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  const messages = getChannelMessages(channelId);

  // Augment messages with reactions
  const messageIds = messages.map((m) => m.id);
  const reactionsMap = getMessagesReactions(messageIds);
  const messagesWithReactions = messages.map((m) => ({
    ...m,
    reactions: reactionsMap.get(m.id) || [],
  }));

  return jsonResponse(messagesWithReactions);
}

export async function handleSendMessage(req: Request, session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannelById(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access for private channels (admins can post to all)
  if (channel.is_public === 0 && !isAdmin(session.npub)) {
    if (!canUserAccessChannel(channelId, session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  const body = await req.json();
  const { content, parentId, encrypted, commands, mentions } = body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return jsonResponse({ error: "Message content is required" }, 400);
  }

  let message;
  if (encrypted) {
    // Client has already encrypted the content
    message = sendEncryptedMessage(
      channelId,
      session.npub,
      content,
      parentId ? Number(parentId) : null,
      1 // keyVersion
    );
  } else {
    message = parentId
      ? replyToMessage(channelId, session.npub, content, parentId)
      : sendMessage(channelId, session.npub, content);
  }

  if (!message) {
    return jsonResponse({ error: "Failed to send message" }, 500);
  }

  // Broadcast new message event
  // Determine recipients based on channel type
  let recipientNpubs: string[] | undefined;

  if (channel.owner_npub) {
    // Personal channel - only owner receives
    recipientNpubs = [channel.owner_npub];
  } else if (channel.is_public === 0) {
    // Private channel or DM - use channel access check
    // For DMs, get participants
    const dmParticipants = getDmParticipants(channelId);
    if (dmParticipants.length > 0) {
      recipientNpubs = dmParticipants.map(p => p.npub);
    }
    // For private group channels, channelId check handles it
  }

  broadcast({
    type: "message:new",
    data: {
      ...message,
      channelId,
    },
    channelId,
    recipientNpubs,
  });

  // Determine the deep link URL based on channel type
  const dmParticipantsForUrl = getDmParticipants(channelId);
  const isDm = dmParticipantsForUrl.length > 0;
  const pushUrl = isDm
    ? `/chat/dm/${channelId}`
    : `/chat/channel/${encodeURIComponent(channel.name)}`;

  // For encrypted messages, don't show content in notification (it's ciphertext)
  // For plaintext messages, show a preview
  const notificationBody = encrypted
    ? "New encrypted message"
    : content.length > 100 ? content.slice(0, 100) + "..." : content;

  // Send push notifications to channel members (async, don't await)
  notifyChannelMessage(recipientNpubs, session.npub, {
    title: channel.display_name || channel.name,
    body: notificationBody,
    url: pushUrl,
    tag: `channel-${channelId}`,
  }).catch((err) => console.error("[Push] Failed to send notifications:", err));

  // Send special "you were mentioned" notifications to mentioned users
  // For encrypted messages, use client-provided mentions metadata
  const mentionedNpubs = encrypted && Array.isArray(mentions) ? mentions : parseMentionsFromBody(content);
  if (mentionedNpubs.length > 0) {
    const sender = getUserByNpub(session.npub);
    const senderName = sender?.display_name || sender?.name || session.npub.slice(0, 12) + "...";
    notifyChannelMessage(mentionedNpubs, session.npub, {
      title: `${senderName} mentioned you`,
      body: encrypted ? "in an encrypted message" : notificationBody,
      url: pushUrl,
      tag: `mention-${channelId}-${message.id}`,
    }).catch((err) => console.error("[Push] Failed to send mention notifications:", err));
  }

  // Execute any slash commands in the message (async, don't await)
  // For encrypted messages, use client-provided commands metadata
  // For plaintext messages, parse from the message body
  const commandsMetadata = encrypted && Array.isArray(commands) ? commands : undefined;
  executeSlashCommands(message, session.npub, commandsMetadata).catch((err) =>
    console.error("[SlashCommands] Failed to execute:", err)
  );

  return jsonResponse(message, 201);
}

export function handleDeleteMessage(session: Session | null, messageId: number) {
  if (!session) return unauthorized();

  const message = getMessage(messageId);
  if (!message) {
    return jsonResponse({ error: "Message not found" }, 404);
  }

  // Only author or admin can delete
  const canDelete = message.author === session.npub || isAdmin(session.npub);
  if (!canDelete) {
    return forbidden("You can only delete your own messages");
  }

  // Delete the message (thread replies cascade automatically via foreign key)
  deleteMessage(messageId);

  // Broadcast deletion event
  broadcast({
    type: "message:delete",
    data: {
      messageId,
      channelId: message.channel_id,
    },
    channelId: message.channel_id,
  });

  return jsonResponse({ success: true });
}

// User endpoints
export function handleListUsers(session: Session | null) {
  if (!session) return unauthorized();
  const users = listUsers();
  return jsonResponse(users);
}

// Get current user's info including admin status
export function handleGetMe(session: Session | null) {
  if (!session) return unauthorized();
  return jsonResponse({
    npub: session.npub,
    pubkey: session.pubkey,
    isAdmin: isAdmin(session.npub),
  });
}

export async function handleUpdateUser(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await req.json();
  const { npub, pubkey, displayName, name, about, picture, nip05 } = body;

  if (!npub || !pubkey) {
    return jsonResponse({ error: "npub and pubkey are required" }, 400);
  }

  const user = upsertUser({
    npub,
    pubkey,
    displayName: displayName || null,
    name: name || null,
    about: about || null,
    picture: picture || null,
    nip05: nip05 || null,
    lastLogin: npub === session.npub ? new Date().toISOString() : null,
  });

  return jsonResponse(user);
}

// DM endpoints
export async function handleCreateDm(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await req.json();
  const { targetNpub, displayName } = body;

  if (!targetNpub || typeof targetNpub !== "string") {
    return jsonResponse({ error: "targetNpub is required" }, 400);
  }

  if (targetNpub === session.npub) {
    return jsonResponse({ error: "Cannot create DM with yourself" }, 400);
  }

  // Use provided displayName or a placeholder (frontend should provide the user's name)
  const dmDisplayName = displayName || "DM";

  const channel = getOrCreateDmChannel(session.npub, targetNpub, dmDisplayName);
  if (!channel) {
    return jsonResponse({ error: "Failed to create DM channel" }, 500);
  }

  // Broadcast DM channel creation to both participants
  broadcast({
    type: "dm:new",
    data: {
      id: channel.id,
      name: channel.name,
      displayName: channel.display_name,
      description: channel.description,
    },
    recipientNpubs: [session.npub, targetNpub],
  });

  return jsonResponse(channel, 201);
}

// ============================================================
// Channel Key Management (E2E Encryption)
// ============================================================

/**
 * Get current user's wrapped channel key
 * GET /chat/channels/:id/keys
 */
export function handleGetChannelKey(session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check access for private channels
  if (channel.is_public === 0 && !isAdmin(session.npub)) {
    if (!canUserAccessChannel(channelId, session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  // Get user's wrapped key
  const key = getUserChannelKey(session.pubkey, channelId);
  if (!key) {
    return jsonResponse({ error: "No key found for this channel" }, 404);
  }

  return jsonResponse({
    encrypted_key: key.encrypted_key,
    key_version: key.key_version,
    created_at: key.created_at,
  });
}

/**
 * Store a wrapped channel key for a user
 * POST /chat/channels/:id/keys
 * Body: { userPubkey, encryptedKey, keyVersion? }
 */
export async function handleStoreChannelKey(req: Request, session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Only channel creator or admin can store keys for other users
  const isOwner = channel.creator === session.npub;
  const userIsAdmin = isAdmin(session.npub);

  const body = await req.json();
  const { userPubkey, encryptedKey, keyVersion } = body;

  if (!userPubkey || !encryptedKey) {
    return jsonResponse({ error: "userPubkey and encryptedKey are required" }, 400);
  }

  // Users can only store their own keys unless they're the owner/admin
  if (userPubkey !== session.pubkey && !isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can store keys for other users");
  }

  // Use provided key version or auto-increment
  const version = keyVersion ?? (getLatestKeyVersion(channelId) + 1);

  const stored = storeUserChannelKey(userPubkey, channelId, encryptedKey, version);
  if (!stored) {
    return jsonResponse({ error: "Failed to store key" }, 500);
  }

  return jsonResponse(stored, 201);
}

/**
 * Store wrapped channel keys for multiple users (batch)
 * POST /chat/channels/:id/keys/batch
 * Body: { keys: [{ userPubkey, encryptedKey }], keyVersion? }
 */
export async function handleStoreChannelKeysBatch(req: Request, session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Only channel creator or admin can store keys in batch
  const isOwner = channel.creator === session.npub;
  const userIsAdmin = isAdmin(session.npub);

  if (!isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can store keys for other users");
  }

  const body = await req.json();
  const { keys, keyVersion, setEncrypted } = body;

  if (!Array.isArray(keys) || keys.length === 0) {
    return jsonResponse({ error: "keys array is required" }, 400);
  }

  // Use provided key version or auto-increment
  const version = keyVersion ?? (getLatestKeyVersion(channelId) + 1);

  const results: Array<{ userPubkey: string; success: boolean }> = [];

  for (const keyEntry of keys) {
    const { userPubkey, encryptedKey } = keyEntry;
    if (!userPubkey || !encryptedKey) {
      results.push({ userPubkey: userPubkey || "unknown", success: false });
      continue;
    }

    const stored = storeUserChannelKey(userPubkey, channelId, encryptedKey, version);
    results.push({ userPubkey, success: !!stored });
  }

  // Optionally mark channel as encrypted
  if (setEncrypted && !channel.encrypted) {
    setChannelEncrypted(channelId);
  }

  return jsonResponse({ results, keyVersion: version }, 201);
}

/**
 * Get all wrapped keys for a channel (admin/owner only, for key rotation)
 * GET /chat/channels/:id/keys/all
 */
export function handleGetChannelKeysAll(session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Only channel creator or admin can see all keys
  const isOwner = channel.creator === session.npub;
  const userIsAdmin = isAdmin(session.npub);

  if (!isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can view all keys");
  }

  const keys = getChannelKeys(channelId);
  return jsonResponse({ keys });
}

/**
 * Get channel members who don't have encryption keys yet
 * GET /chat/channels/:id/keys/pending
 */
export function handleGetPendingKeyMembers(session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Only channel creator or admin can see pending members
  const isOwner = channel.creator === session.npub;
  const userIsAdmin = isAdmin(session.npub);

  if (!isOwner && !userIsAdmin) {
    return forbidden("Only channel owner can view pending key members");
  }

  // Get npubs that need keys
  const pendingNpubs = getChannelMembersWithoutKeys(channelId);

  // Convert to objects with pubkey for key wrapping
  const pendingMembers = pendingNpubs.map(npub => {
    const user = getUserByNpub(npub);
    return {
      npub,
      pubkey: user?.pubkey || null,
      displayName: user?.display_name || null,
    };
  }).filter(m => m.pubkey); // Only include members with known pubkeys

  return jsonResponse({ pendingMembers, channelEncrypted: channel.encrypted === 1 });
}

/**
 * Toggle reaction on a message
 * POST /api/messages/:id/reactions
 * Body: { emoji: string }
 */
export async function handleToggleReaction(req: Request, session: Session | null, messageId: number) {
  if (!session) return unauthorized();

  const message = getMessage(messageId);
  if (!message) {
    return jsonResponse({ error: "Message not found" }, 404);
  }

  // Check if user has access to the channel
  if (!canUserAccessChannel(message.channel_id, session.npub) && !isAdmin(session.npub)) {
    return forbidden("You don't have access to this message");
  }

  const body = await req.json();
  const { emoji } = body;

  if (!emoji || typeof emoji !== "string" || !emoji.trim()) {
    return jsonResponse({ error: "Emoji is required" }, 400);
  }

  // Toggle the reaction
  const result = toggleReaction(messageId, session.npub, emoji.trim());

  // Get updated reactions for the message
  const reactions = getMessageReactions(messageId);

  // Broadcast reaction event
  broadcast({
    type: "message:reaction",
    data: {
      messageId,
      emoji: emoji.trim(),
      reactor: session.npub,
      action: result.action,
      reactions,
    },
    channelId: message.channel_id,
  });

  return jsonResponse({
    success: true,
    action: result.action,
    reactions,
  });
}

/**
 * Pin a message to a channel
 * POST /api/channels/:id/messages/:messageId/pin
 */
export function handlePinMessage(
  _req: Request,
  session: Session | null,
  channelId: number,
  messageId: number
) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check if user is channel creator or admin
  const canPin = channel.creator === session.npub || isAdmin(session.npub);
  if (!canPin) {
    return forbidden("Only channel admins can pin messages");
  }

  const message = getMessage(messageId);
  if (!message) {
    return jsonResponse({ error: "Message not found" }, 404);
  }

  // Message must belong to this channel
  if (message.channel_id !== channelId) {
    return jsonResponse({ error: "Message not in this channel" }, 400);
  }

  const pinned = pinMessage(channelId, messageId, session.npub);

  if (pinned) {
    broadcast({
      type: "message:pinned",
      data: {
        channelId,
        messageId,
        pinnedBy: session.npub,
      },
      channelId,
    });
  }

  return jsonResponse({ success: true, pinned });
}

/**
 * Unpin a message from a channel
 * DELETE /api/channels/:id/messages/:messageId/pin
 */
export function handleUnpinMessage(
  _req: Request,
  session: Session | null,
  channelId: number,
  messageId: number
) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check if user is channel creator or admin
  const canUnpin = channel.creator === session.npub || isAdmin(session.npub);
  if (!canUnpin) {
    return forbidden("Only channel admins can unpin messages");
  }

  const removed = unpinMessage(channelId, messageId);

  if (removed) {
    broadcast({
      type: "message:unpinned",
      data: {
        channelId,
        messageId,
        unpinnedBy: session.npub,
      },
      channelId,
    });
  }

  return jsonResponse({ success: true, removed });
}

/**
 * Get all pinned messages for a channel
 * GET /api/channels/:id/pinned
 */
export function handleGetPinnedMessages(
  _req: Request,
  session: Session | null,
  channelId: number
) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check if user has access to the channel
  if (!canUserAccessChannel(channelId, session.npub) && !isAdmin(session.npub)) {
    return forbidden("You don't have access to this channel");
  }

  const pinned = getPinnedMessages(channelId);

  // Check if current user can pin (for UI purposes)
  const canPin = channel.creator === session.npub || isAdmin(session.npub);

  return jsonResponse({ pinned, canPin });
}

/**
 * Check if a specific message is pinned
 * GET /api/channels/:id/messages/:messageId/pinned
 */
export function handleCheckMessagePinned(
  _req: Request,
  session: Session | null,
  channelId: number,
  messageId: number
) {
  if (!session) return unauthorized();

  const channel = getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  if (!canUserAccessChannel(channelId, session.npub) && !isAdmin(session.npub)) {
    return forbidden("You don't have access to this channel");
  }

  const isPinned = isMessagePinned(channelId, messageId);
  const canPin = channel.creator === session.npub || isAdmin(session.npub);

  return jsonResponse({ isPinned, canPin });
}
