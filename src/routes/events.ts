/**
 * SSE endpoint for real-time updates
 *
 * Multi-tenant: SSE connections are namespaced by team slug
 */


import { isAdmin } from "../config";
import { createTeamRouteContext, hasTeam } from "../context";
import { forbidden, unauthorized } from "../http";
import { registerClient, sendInitialSync, unregisterClient } from "../services/events";

import type { RequestContext } from "../context";
import type { Session } from "../types";
import type { Database } from "bun:sqlite";

/**
 * Handle SSE connection request for team-scoped routes
 * GET /t/{team}/chat/events
 */
export function handleTeamChatEvents(
  req: Request,
  session: Session | null,
  teamSlug: string
): Response {
  const result = createTeamRouteContext(session, teamSlug);
  if (!result.ok) return result.response;

  return handleChatEvents(req, result.ctx);
}

/**
 * Handle SSE connection request
 * GET /chat/events
 */
export function handleChatEvents(req: Request, ctx: RequestContext): Response {
  if (!ctx.session) {
    return unauthorized();
  }

  if (!hasTeam(ctx)) {
    return forbidden("No team selected");
  }

  const npub = ctx.session.npub;
  const teamSlug = ctx.teamSlug;
  const teamDb = ctx.teamDb;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Register this client for this team
      registerClient(teamSlug, npub, controller);

      // Send initial sync data
      const initialData = getInitialSyncData(teamDb, npub);
      sendInitialSync(teamSlug, npub, initialData);
    },
    cancel() {
      // Client disconnected
      unregisterClient(teamSlug, npub);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}

/**
 * Get initial sync data for a newly connected client
 */
function getInitialSyncData(teamDb: Database, npub: string) {
  // Get channels visible to this user
  const channels = isAdmin(npub)
    ? listAllChannels(teamDb)
    : listVisibleChannels(teamDb, npub);

  // Get DM channels
  const dmChannels = listDmChannels(teamDb, npub);

  // Get personal channel
  const personalChannel = getOrCreatePersonalChannel(teamDb, npub);

  // Get unread counts
  const unreadCounts = getUnreadCounts(teamDb, npub);

  return {
    channels: channels.map(formatChannel),
    dmChannels: dmChannels.map(formatDmChannel),
    personalChannel: personalChannel ? formatChannel(personalChannel) : null,
    unreadState: Object.fromEntries(
      unreadCounts.map((u) => [u.channel_id, { unread: u.unread_count, mentions: u.mention_count }])
    ),
    timestamp: Date.now(),
  };
}

/**
 * Team-aware database query functions
 */
function listAllChannels(db: Database) {
  return db
    .query<ChannelRow, []>(
      "SELECT id, name, display_name, description, is_public, owner_npub, encrypted FROM channels WHERE name NOT LIKE 'dm-%' AND owner_npub IS NULL ORDER BY id"
    )
    .all();
}

function listVisibleChannels(db: Database, npub: string) {
  return db
    .query<ChannelRow, [string, string]>(
      `SELECT DISTINCT c.id, c.name, c.display_name, c.description, c.is_public, c.owner_npub, c.encrypted
       FROM channels c
       LEFT JOIN channel_groups cg ON c.id = cg.channel_id
       LEFT JOIN group_members gm ON cg.group_id = gm.group_id
       WHERE c.name NOT LIKE 'dm-%'
         AND c.owner_npub IS NULL
         AND (c.is_public = 1 OR gm.npub = ?)
       ORDER BY c.id`
    )
    .all(npub, npub);
}

function listDmChannels(db: Database, npub: string) {
  return db
    .query<DmChannelRow, [string, string]>(
      `SELECT c.id, c.name, c.display_name, c.description,
              (SELECT dp2.npub FROM dm_participants dp2
               WHERE dp2.channel_id = c.id AND dp2.npub != ?) as other_npub
       FROM channels c
       JOIN dm_participants dp ON c.id = dp.channel_id
       WHERE c.name LIKE 'dm-%' AND dp.npub = ?
       ORDER BY c.id DESC`
    )
    .all(npub, npub);
}

function getOrCreatePersonalChannel(db: Database, npub: string) {
  type PersonalChannelRow = ChannelRow & { owner_npub: string };
  const existing = db
    .query<PersonalChannelRow, [string]>(
      "SELECT id, name, display_name, description, is_public, owner_npub, encrypted FROM channels WHERE owner_npub = ?"
    )
    .get(npub);
  if (existing) return existing;

  // Create a unique name using a short hash of the npub
  const shortHash = npub.slice(-8);
  const name = `notes-${shortHash}`;
  const result = db
    .query<PersonalChannelRow, [string, string, string]>(
      `INSERT INTO channels (name, display_name, description, creator, is_public, owner_npub)
       VALUES (?, 'Notes', 'Personal notes', ?, 0, ?)
       RETURNING id, name, display_name, description, is_public, owner_npub, encrypted`
    )
    .get(name, npub, npub);
  return result ?? null;
}

function getUnreadCounts(db: Database, npub: string) {
  return db
    .query<UnreadCountRow, [string, string, string, string]>(
      `SELECT
         c.id as channel_id,
         COALESCE(
           (SELECT COUNT(*) FROM messages m
            WHERE m.channel_id = c.id
              AND m.created_at > COALESCE(
                (SELECT last_read_at FROM channel_read_state WHERE npub = ? AND channel_id = c.id),
                '1970-01-01'
              )
           ), 0
         ) as unread_count,
         COALESCE(
           (SELECT COUNT(*) FROM message_mentions mm
            JOIN messages m ON mm.message_id = m.id
            WHERE m.channel_id = c.id
              AND mm.mentioned_npub = ?
              AND m.created_at > COALESCE(
                (SELECT last_read_at FROM channel_read_state WHERE npub = ? AND channel_id = c.id),
                '1970-01-01'
              )
           ), 0
         ) as mention_count
       FROM channels c
       LEFT JOIN channel_groups cg ON c.id = cg.channel_id
       LEFT JOIN group_members gm ON cg.group_id = gm.group_id
       WHERE c.is_public = 1 OR gm.npub = ? OR c.owner_npub = ?
       GROUP BY c.id`
    )
    .all(npub, npub, npub, npub, npub);
}

type ChannelRow = {
  id: number;
  name: string;
  display_name: string;
  description: string;
  is_public: number;
  owner_npub?: string | null;
  encrypted?: number;
};

type DmChannelRow = ChannelRow & { other_npub?: string };

type UnreadCountRow = {
  channel_id: number;
  unread_count: number;
  mention_count: number;
};

/**
 * Format channel for client consumption
 */
function formatChannel(ch: {
  id: number;
  name: string;
  display_name: string;
  description: string;
  is_public: number;
  owner_npub?: string | null;
  encrypted?: number;
}) {
  return {
    id: ch.id,
    name: ch.name,
    displayName: ch.display_name,
    description: ch.description,
    isPublic: ch.is_public === 1,
    ownerNpub: ch.owner_npub || null,
    encrypted: ch.encrypted === 1,
  };
}

/**
 * Format DM channel for client consumption
 */
function formatDmChannel(ch: {
  id: number;
  name: string;
  display_name: string;
  description: string;
  other_npub?: string;
}) {
  return {
    id: ch.id,
    name: ch.name,
    displayName: ch.display_name,
    description: ch.description,
    otherNpub: ch.other_npub || null,
  };
}
