import { canUserAccessChannel, getOrCreatePersonalChannel, listAllChannels, listUsers, listVisibleChannels, upsertUser } from "../db";
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

import type { Session } from "../types";

function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

export function handleChatPage(session: Session | null) {
  const page = renderChatPage(session);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function handleListChannels(session: Session | null) {
  if (!session) return unauthorized();

  // Admins see all channels, regular users see only visible ones
  const channels = isAdmin(session.npub)
    ? listAllChannels()
    : listVisibleChannels(session.npub);

  // Get or create personal "Note to self" channel and append at end
  const personalChannel = getOrCreatePersonalChannel(session.npub);
  if (personalChannel) {
    channels.push(personalChannel);
  }

  return jsonResponse(channels);
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

  return jsonResponse(channel);
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

  return jsonResponse(message, 201);
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
