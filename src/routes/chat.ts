import { jsonResponse, unauthorized } from "../http";
import {
  createNewChannel,
  editChannel,
  getAllChannels,
  getChannelById,
  getChannelMessages,
  replyToMessage,
  sendMessage,
} from "../services/chat";

import type { Session } from "../types";

export function handleListChannels(session: Session | null) {
  if (!session) return unauthorized();
  const channels = getAllChannels();
  return jsonResponse(channels);
}

export function handleGetChannel(session: Session | null, id: number) {
  if (!session) return unauthorized();
  const channel = getChannelById(id);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
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

  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "-");
  const channel = createNewChannel(
    normalizedName,
    displayName?.trim() || normalizedName,
    description?.trim() || "",
    session.npub,
    isPublic !== false
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

  const body = await req.json();
  const { displayName, description, isPublic } = body;

  const channel = editChannel(
    id,
    displayName?.trim() || existing.display_name,
    description?.trim() ?? existing.description,
    isPublic ?? existing.is_public === 1
  );

  return jsonResponse(channel);
}

export function handleGetMessages(session: Session | null, channelId: number) {
  if (!session) return unauthorized();

  const channel = getChannelById(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
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
