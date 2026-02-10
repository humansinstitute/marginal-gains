/**
 * Team chat user handlers
 */

import { isAdmin } from "../../config";
import { jsonResponse } from "../../http";
import { getTeamBySlug, getTeamMembers } from "../../master-db";
import { broadcast } from "../../services/events";
import { TeamDatabase } from "../../team-db";

import { forbidden, requireTeamContext } from "./helpers";

import type { Session } from "../../types";

export function handleTeamListUsers(
  session: Session | null,
  teamSlug: string
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  // Get users from team database (those who have sent messages or updated profile)
  const teamDbUsers = db.listUsers();
  const usersByNpub = new Map(teamDbUsers.map((u) => [u.npub, u]));

  // Also get all team members from master database
  // This ensures new members appear in the DM list even if they haven't interacted yet
  const team = getTeamBySlug(teamSlug);
  if (team) {
    const members = getTeamMembers(team.id);
    for (const member of members) {
      if (!usersByNpub.has(member.user_npub)) {
        // Add a minimal user entry for members not yet in team DB
        usersByNpub.set(member.user_npub, {
          id: 0, // Placeholder - not a real DB id
          npub: member.user_npub,
          pubkey: "", // Will be filled when they interact
          display_name: null,
          name: null,
          about: null,
          picture: null,
          nip05: null,
          last_login: null,
          updated_at: member.joined_at,
        });
      }
    }
  }

  const users = Array.from(usersByNpub.values());
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

export function handleTeamArchiveDm(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  channelId: number
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  // Verify the channel exists and user is a participant
  const participants = db.getDmParticipants(channelId);
  if (!participants.includes(ctx.session.npub)) {
    return forbidden("You are not a participant in this DM");
  }

  const success = db.archiveDmChannel(channelId, ctx.session.npub);
  if (!success) {
    return jsonResponse({ error: "Failed to archive DM" }, 500);
  }

  return jsonResponse({ success: true });
}
