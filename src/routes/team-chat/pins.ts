/**
 * Team chat pin handlers
 */

import { isAdmin } from "../../config";
import { jsonResponse } from "../../http";
import { broadcast } from "../../services/events";
import { TeamDatabase } from "../../team-db";

import { forbidden, requireTeamContext } from "./helpers";

import type { Session } from "../../types";

/**
 * Pin a message to a channel
 * POST /t/:teamSlug/api/channels/:id/messages/:messageId/pin
 */
export function handleTeamPinMessage(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number,
  messageId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check if user is channel creator or admin
  const canPin = channel.creator === ctx.session.npub || isAdmin(ctx.session.npub);
  if (!canPin) {
    return forbidden("Only channel admins can pin messages");
  }

  const message = db.getMessage(messageId);
  if (!message) {
    return jsonResponse({ error: "Message not found" }, 404);
  }

  // Message must belong to this channel
  if (message.channel_id !== channelId) {
    return jsonResponse({ error: "Message not in this channel" }, 400);
  }

  const pinned = db.pinMessage(channelId, messageId, ctx.session.npub);

  if (pinned) {
    broadcast(teamSlug, ctx.teamDb, {
      type: "message:pinned",
      data: {
        channelId,
        messageId,
        pinnedBy: ctx.session.npub,
      },
      channelId,
    });
  }

  return jsonResponse({ success: true, pinned });
}

/**
 * Unpin a message from a channel
 * DELETE /t/:teamSlug/api/channels/:id/messages/:messageId/pin
 */
export function handleTeamUnpinMessage(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number,
  messageId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const channel = db.getChannel(channelId);
  if (!channel) {
    return jsonResponse({ error: "Channel not found" }, 404);
  }

  // Check if user is channel creator or admin
  const canUnpin = channel.creator === ctx.session.npub || isAdmin(ctx.session.npub);
  if (!canUnpin) {
    return forbidden("Only channel admins can unpin messages");
  }

  const removed = db.unpinMessage(channelId, messageId);

  if (removed) {
    broadcast(teamSlug, ctx.teamDb, {
      type: "message:unpinned",
      data: {
        channelId,
        messageId,
        unpinnedBy: ctx.session.npub,
      },
      channelId,
    });
  }

  return jsonResponse({ success: true, removed });
}

/**
 * Get all pinned messages for a channel
 * GET /t/:teamSlug/api/channels/:id/pinned
 */
export function handleTeamGetPinnedMessages(
  _req: Request,
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

  // Check if user has access to the channel
  if (channel.is_public === 0 && !isAdmin(ctx.session.npub)) {
    if (!db.canUserAccessChannel(channelId, ctx.session.npub)) {
      return forbidden("You don't have access to this channel");
    }
  }

  const pinned = db.getPinnedMessages(channelId);

  // Check if current user can pin (for UI purposes)
  const canPin = channel.creator === ctx.session.npub || isAdmin(ctx.session.npub);

  return jsonResponse({ pinned, canPin });
}

/**
 * Check if a specific message is pinned
 * GET /t/:teamSlug/api/channels/:id/messages/:messageId/pinned
 */
export function handleTeamCheckMessagePinned(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number,
  messageId: number
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

  const isPinned = db.isMessagePinned(channelId, messageId);
  const canPin = channel.creator === ctx.session.npub || isAdmin(ctx.session.npub);

  return jsonResponse({ isPinned, canPin });
}
