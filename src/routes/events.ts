/**
 * SSE endpoint for real-time updates
 */

import { isAdmin } from "../config";
import { getUnreadCounts, listAllChannels, listDmChannels, listVisibleChannels, getOrCreatePersonalChannel } from "../db";
import { unauthorized } from "../http";
import { registerClient, unregisterClient, sendInitialSync } from "../services/events";

import type { Session } from "../types";

/**
 * Handle SSE connection request
 * GET /chat/events
 */
export function handleChatEvents(req: Request, session: Session | null): Response {
  if (!session) {
    return unauthorized();
  }

  const npub = session.npub;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Register this client
      registerClient(npub, controller);

      // Send initial sync data
      const initialData = getInitialSyncData(npub);
      sendInitialSync(npub, initialData);
    },
    cancel() {
      // Client disconnected
      unregisterClient(npub);
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
function getInitialSyncData(npub: string) {
  // Get channels visible to this user
  const channels = isAdmin(npub)
    ? listAllChannels()
    : listVisibleChannels(npub);

  // Get DM channels
  const dmChannels = listDmChannels(npub);

  // Get personal channel
  const personalChannel = getOrCreatePersonalChannel(npub);

  // Get unread counts
  const unreadCounts = getUnreadCounts(npub);

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
