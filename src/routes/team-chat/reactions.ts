/**
 * Team chat reaction handlers
 */

import { isAdmin } from "../../config";
import { jsonResponse } from "../../http";
import { broadcast } from "../../services/events";
import { TeamDatabase } from "../../team-db";

import { forbidden, requireTeamContext } from "./helpers";

import type { Session } from "../../types";

/**
 * Toggle reaction on a message
 * POST /t/:teamSlug/api/messages/:id/reactions
 * Body: { emoji: string }
 */
export async function handleTeamToggleReaction(
  req: Request,
  session: Session | null,
  teamSlug: string,
  messageId: number
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const message = db.getMessage(messageId);
  if (!message) {
    return jsonResponse({ error: "Message not found" }, 404);
  }

  // Check if user has access to the channel
  const channel = db.getChannel(message.channel_id);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  if (channel.is_public === 0 && !isAdmin(ctx.session.npub)) {
    if (!db.canUserAccessChannel(message.channel_id, ctx.session.npub)) {
      return forbidden("You don't have access to this message");
    }
  }

  const body = await req.json();
  const { emoji } = body;

  if (!emoji || typeof emoji !== "string" || !emoji.trim()) {
    return jsonResponse({ error: "Emoji is required" }, 400);
  }

  // Toggle the reaction
  const toggleResult = db.toggleReaction(messageId, ctx.session.npub, emoji.trim());

  // Get updated reactions for the message
  const reactions = db.getMessageReactions(messageId);

  // Broadcast reaction event
  broadcast(teamSlug, ctx.teamDb, {
    type: "message:reaction",
    data: {
      messageId,
      emoji: emoji.trim(),
      reactor: ctx.session.npub,
      action: toggleResult.action,
      reactions,
    },
    channelId: message.channel_id,
  });

  return jsonResponse({
    success: true,
    action: toggleResult.action,
    reactions,
  });
}
