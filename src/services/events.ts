/**
 * Server-Sent Events (SSE) broadcaster service
 * Manages connected clients and broadcasts events to relevant users
 *
 * Multi-tenant: Connections are namespaced by team slug to ensure
 * events are only sent to clients within the same team.
 */

import { isAdmin } from "../config";

import type { Database } from "bun:sqlite";


// Event types that can be broadcast
export type EventType =
  | "message:new"
  | "channel:new"
  | "channel:update"
  | "channel:delete"
  | "dm:new"
  | "sync:init"
  | "wingman:thinking"
  | "wallet:balance"
  | "wallet:transaction";

export interface BroadcastEvent {
  type: EventType;
  data: unknown;
  // Optional: limit recipients
  channelId?: number;
  recipientNpubs?: string[]; // If set, only these users receive the event
}

interface ConnectedClient {
  npub: string;
  teamSlug: string;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
}

// Store connected clients by team slug, then by npub
// Map<teamSlug, Map<npub, ConnectedClient>>
const connectedClients = new Map<string, Map<string, ConnectedClient>>();

/**
 * Get the clients map for a specific team (creates if doesn't exist)
 */
function getTeamClients(teamSlug: string): Map<string, ConnectedClient> {
  let teamClients = connectedClients.get(teamSlug);
  if (!teamClients) {
    teamClients = new Map();
    connectedClients.set(teamSlug, teamClients);
  }
  return teamClients;
}

/**
 * Get total count of connected clients across all teams
 */
function getTotalClientCount(): number {
  let total = 0;
  for (const teamClients of connectedClients.values()) {
    total += teamClients.size;
  }
  return total;
}

/**
 * Register a new SSE client connection
 */
export function registerClient(
  teamSlug: string,
  npub: string,
  controller: ReadableStreamDefaultController
): void {
  const teamClients = getTeamClients(teamSlug);

  // Close existing connection if any (single connection per user per team)
  const existing = teamClients.get(npub);
  if (existing) {
    try {
      existing.controller.close();
    } catch {
      // Ignore close errors
    }
  }

  teamClients.set(npub, {
    npub,
    teamSlug,
    controller,
    connectedAt: new Date(),
  });

  console.log(`[SSE] Client connected: ${npub.slice(0, 12)}... to team '${teamSlug}' (${getTotalClientCount()} total)`);
}

/**
 * Unregister a client connection
 */
export function unregisterClient(teamSlug: string, npub: string): void {
  const teamClients = connectedClients.get(teamSlug);
  if (teamClients) {
    teamClients.delete(npub);
    // Clean up empty team maps
    if (teamClients.size === 0) {
      connectedClients.delete(teamSlug);
    }
  }
  console.log(`[SSE] Client disconnected: ${npub.slice(0, 12)}... from team '${teamSlug}' (${getTotalClientCount()} total)`);
}

/**
 * Send an event to a specific client
 */
function sendToClient(client: ConnectedClient, event: BroadcastEvent): boolean {
  try {
    const eventData = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    client.controller.enqueue(new TextEncoder().encode(eventData));
    return true;
  } catch (err) {
    console.error(`[SSE] Failed to send to ${client.npub.slice(0, 12)}...`, err);
    return false;
  }
}

/**
 * Check if user can access a channel (team-aware version)
 */
function canUserAccessChannelInTeam(
  teamDb: Database,
  channelId: number,
  npub: string
): boolean {
  const result = teamDb
    .query<{ can_access: number }, [number, string, string, string]>(
      `SELECT 1 as can_access FROM channels c
       WHERE c.id = ? AND (
         c.is_public = 1
         OR c.owner_npub = ?
         OR EXISTS (
           SELECT 1 FROM dm_participants dp WHERE dp.channel_id = c.id AND dp.npub = ?
         )
         OR EXISTS (
           SELECT 1 FROM channel_groups cg
           JOIN group_members gm ON gm.group_id = cg.group_id
           WHERE cg.channel_id = c.id AND gm.npub = ?
         )
       )`
    )
    .get(channelId, npub, npub, npub);
  return result !== undefined;
}

/**
 * Broadcast an event to relevant clients within a team
 */
export function broadcast(teamSlug: string, teamDb: Database, event: BroadcastEvent): void {
  const teamClients = connectedClients.get(teamSlug);
  if (!teamClients) {
    return; // No clients connected to this team
  }

  const failedClients: string[] = [];

  for (const [npub, client] of teamClients) {
    // Check if this client should receive the event
    if (!shouldReceiveEvent(teamDb, npub, event)) {
      continue;
    }

    const success = sendToClient(client, event);
    if (!success) {
      failedClients.push(npub);
    }
  }

  // Clean up failed connections
  for (const npub of failedClients) {
    unregisterClient(teamSlug, npub);
  }
}

/**
 * LEGACY: Broadcast to all connected teams
 *
 * This is a backward-compatibility function for routes that haven't been
 * migrated to use RequestContext yet. It broadcasts to all connected
 * teams without channel access checking.
 *
 * TODO: Migrate all routes to use the team-aware broadcast() function
 * and remove this legacy function.
 */
export function broadcastLegacy(event: BroadcastEvent): void {
  const failedClients: Array<{ teamSlug: string; npub: string }> = [];

  for (const [teamSlug, teamClients] of connectedClients) {
    for (const [npub, client] of teamClients) {
      // For legacy broadcasts, only filter by recipientNpubs
      if (event.recipientNpubs && event.recipientNpubs.length > 0) {
        if (!event.recipientNpubs.includes(npub)) {
          continue;
        }
      }

      const success = sendToClient(client, event);
      if (!success) {
        failedClients.push({ teamSlug, npub });
      }
    }
  }

  // Clean up failed connections
  for (const { teamSlug, npub } of failedClients) {
    unregisterClient(teamSlug, npub);
  }
}

/**
 * Determine if a user should receive a specific event
 */
function shouldReceiveEvent(teamDb: Database, npub: string, event: BroadcastEvent): boolean {
  // If specific recipients are set, check if user is in the list
  if (event.recipientNpubs && event.recipientNpubs.length > 0) {
    return event.recipientNpubs.includes(npub);
  }

  // If event is for a specific channel, check access
  if (event.channelId) {
    // Admins can see all
    if (isAdmin(npub)) {
      return true;
    }
    // Check channel access within the team's database
    return canUserAccessChannelInTeam(teamDb, event.channelId, npub);
  }

  // Default: send to everyone in the team (for public events like new public channels)
  return true;
}

/**
 * Send initial sync data to a newly connected client
 */
export function sendInitialSync(teamSlug: string, npub: string, data: unknown): void {
  const teamClients = connectedClients.get(teamSlug);
  if (!teamClients) return;

  const client = teamClients.get(npub);
  if (client) {
    sendToClient(client, {
      type: "sync:init",
      data,
    });
  }
}

/**
 * Get count of connected clients (for monitoring)
 * If teamSlug provided, returns count for that team only
 */
export function getConnectedCount(teamSlug?: string): number {
  if (teamSlug) {
    const teamClients = connectedClients.get(teamSlug);
    return teamClients?.size ?? 0;
  }
  return getTotalClientCount();
}

/**
 * Get connection statistics per team (for monitoring/debugging)
 */
export function getConnectionStats(): { total: number; byTeam: Record<string, number> } {
  const byTeam: Record<string, number> = {};
  for (const [slug, clients] of connectedClients) {
    byTeam[slug] = clients.size;
  }
  return {
    total: getTotalClientCount(),
    byTeam,
  };
}

/**
 * Send a heartbeat/ping to keep connections alive
 */
export function sendHeartbeat(): void {
  const encoder = new TextEncoder();
  const heartbeat = encoder.encode(": heartbeat\n\n");

  // Collect failed clients with their team slugs
  const failedClients: Array<{ teamSlug: string; npub: string }> = [];

  for (const [teamSlug, teamClients] of connectedClients) {
    for (const [npub, client] of teamClients) {
      try {
        client.controller.enqueue(heartbeat);
      } catch {
        failedClients.push({ teamSlug, npub });
      }
    }
  }

  // Clean up failed connections
  for (const { teamSlug, npub } of failedClients) {
    unregisterClient(teamSlug, npub);
  }
}

// Send heartbeat every 30 seconds to keep connections alive
setInterval(sendHeartbeat, 30000);
