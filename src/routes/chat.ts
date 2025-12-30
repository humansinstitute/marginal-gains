import { canUserAccessChannel, deleteChannel, deleteMessage, getDmParticipants, getMessage, getOrCreateDmChannel, getOrCreatePersonalChannel, listAllChannels, listDmChannels, listUsers, listVisibleChannels, upsertUser } from "../db";
import { isAdmin } from "../config";
import { jsonResponse, unauthorized } from "../http";
import { renderChatPage } from "../render/chat";
import {
  createNewChannel,
  editChannel,
  getChannelById,
  getChannelMessages,
  replyToMessage,
  sendMessage,
} from "../services/chat";
import { broadcast } from "../services/events";
import { notifyChannelMessage } from "../services/push";

import type { DeepLink, Session } from "../types";

function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

export function handleChatPage(session: Session | null, deepLink?: DeepLink) {
  const page = renderChatPage(session, deepLink);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function handleListChannels(session: Session | null) {
  if (!session) return unauthorized();

  // Admins see all channels, regular users see only visible ones
  const channels = isAdmin(session.npub)
    ? listAllChannels()
    : listVisibleChannels(session.npub);

  // Get DM channels for this user
  const dmChannels = listDmChannels(session.npub);

  // Get or create personal "Note to self" channel and append at end
  const personalChannel = getOrCreatePersonalChannel(session.npub);

  return jsonResponse({
    channels,
    dmChannels,
    personalChannel,
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
  const { name, displayName, description, isPublic } = body;

  if (!name || typeof name !== "string") {
    return jsonResponse({ error: "Name is required" }, 400);
  }

  // Only admins can create private channels
  const channelIsPublic = isPublic !== false;
  if (!channelIsPublic && !isAdmin(session.npub)) {
    return forbidden("Only admins can create private channels");
  }

  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "-");
  const channel = createNewChannel(
    normalizedName,
    displayName?.trim() || normalizedName,
    description?.trim() || "",
    session.npub,
    channelIsPublic
  );

  if (!channel) {
    return jsonResponse({ error: "Channel name already exists" }, 409);
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
  return jsonResponse(messages);
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
  const { content, parentId } = body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return jsonResponse({ error: "Message content is required" }, 400);
  }

  const message = parentId
    ? replyToMessage(channelId, session.npub, content, parentId)
    : sendMessage(channelId, session.npub, content);

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

  // Send push notifications to users with "on_update" frequency (async, don't await)
  notifyChannelMessage(recipientNpubs, session.npub, {
    title: channel.display_name || channel.name,
    body: content.length > 100 ? content.slice(0, 100) + "..." : content,
    url: pushUrl,
    tag: `channel-${channelId}`,
  }).catch((err) => console.error("[Push] Failed to send notifications:", err));

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
