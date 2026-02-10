/**
 * Team chat channel CRUD handlers
 */

import { getWingmanIdentity, isAdmin } from "../../config";
import { jsonResponse } from "../../http";
import { broadcast } from "../../services/events";
import { TeamDatabase } from "../../team-db";

import { forbidden, requireTeamContext } from "./helpers";

import type { Session } from "../../types";

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

  // Include channel layout from app_settings
  const layoutRaw = db.getSetting("channel.layout");
  let channelLayout = null;
  if (layoutRaw) {
    try {
      channelLayout = JSON.parse(layoutRaw);
    } catch {
      // ignore malformed layout
    }
  }

  return jsonResponse({
    channels,
    dmChannels,
    personalChannel,
    channelLayout,
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
