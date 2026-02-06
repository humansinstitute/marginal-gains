/**
 * Team chat message handlers
 */

import { isAdmin } from "../../config";
import { jsonResponse } from "../../http";
import { broadcast } from "../../services/events";
import { TeamDatabase } from "../../team-db";

import { forbidden, requireTeamContext } from "./helpers";

import type { Session } from "../../types";

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

  const messages = db.listMessages(channelId);

  // Augment messages with reactions
  const messageIds = messages.map((m) => m.id);
  const reactionsMap = db.getMessagesReactions(messageIds);
  const messagesWithReactions = messages.map((m) => ({
    ...m,
    reactions: reactionsMap.get(m.id) || [],
  }));

  console.log(`[TeamChat] GetMessages: team=${teamSlug}, channel=${channelId}, user=${ctx.session.npub.slice(0, 15)}, messageCount=${messages.length}`);
  return jsonResponse(messagesWithReactions);
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

  // Calculate threadRootId from parent if replying
  let threadRootId: number | null = null;
  const parentIdNum = parentId ? Number(parentId) : null;
  if (parentIdNum) {
    const parent = db.getMessage(parentIdNum);
    if (parent) {
      threadRootId = parent.thread_root_id ?? parent.id;
    }
  }

  let message;
  if (encrypted) {
    message = db.createEncryptedMessage(
      channelId,
      ctx.session.npub,
      content,
      threadRootId,
      parentIdNum,
      null, // quotedMessageId
      1     // keyVersion
    );
  } else {
    message = db.createMessage(channelId, ctx.session.npub, content, threadRootId, parentIdNum, null);
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
