/**
 * Team chat encryption key management handlers (E2E Encryption)
 */

import { isAdmin } from "../../config";
import { jsonResponse } from "../../http";
import { TeamDatabase } from "../../team-db";

import { forbidden, requireTeamContext } from "./helpers";

import type { Session } from "../../types";

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

/**
 * Get all encrypted channels with pending key distributions.
 * Returns channels where the current user (admin/owner) can distribute keys.
 * Used for background key distribution on app load.
 */
export function handleTeamGetAllPendingKeys(
  session: Session | null,
  teamSlug: string
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);
  const userIsAdmin = isAdmin(ctx.session.npub);

  const channelsWithPending = db.getEncryptedChannelsWithPendingKeys(
    ctx.session.npub,
    userIsAdmin
  );

  return jsonResponse({
    channels: channelsWithPending,
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
