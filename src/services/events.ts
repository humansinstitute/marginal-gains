/**
 * Server-Sent Events (SSE) broadcaster service
 * Manages connected clients and broadcasts events to relevant users
 */

import { isAdmin } from "../config";
import { canUserAccessChannel } from "../db";

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
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
}

// Store connected clients by npub (one connection per user for now)
const connectedClients = new Map<string, ConnectedClient>();

/**
 * Register a new SSE client connection
 */
export function registerClient(
  npub: string,
  controller: ReadableStreamDefaultController
): void {
  // Close existing connection if any (single connection per user)
  const existing = connectedClients.get(npub);
  if (existing) {
    try {
      existing.controller.close();
    } catch {
      // Ignore close errors
    }
  }

  connectedClients.set(npub, {
    npub,
    controller,
    connectedAt: new Date(),
  });

  console.log(`[SSE] Client connected: ${npub.slice(0, 12)}... (${connectedClients.size} total)`);
}

/**
 * Unregister a client connection
 */
export function unregisterClient(npub: string): void {
  connectedClients.delete(npub);
  console.log(`[SSE] Client disconnected: ${npub.slice(0, 12)}... (${connectedClients.size} total)`);
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
 * Broadcast an event to relevant clients
 */
export function broadcast(event: BroadcastEvent): void {
  const failedClients: string[] = [];

  for (const [npub, client] of connectedClients) {
    // Check if this client should receive the event
    if (!shouldReceiveEvent(npub, event)) {
      continue;
    }

    const success = sendToClient(client, event);
    if (!success) {
      failedClients.push(npub);
    }
  }

  // Clean up failed connections
  for (const npub of failedClients) {
    unregisterClient(npub);
  }
}

/**
 * Determine if a user should receive a specific event
 */
function shouldReceiveEvent(npub: string, event: BroadcastEvent): boolean {
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
    // Check channel access
    return canUserAccessChannel(event.channelId, npub);
  }

  // Default: send to everyone (for public events like new public channels)
  return true;
}

/**
 * Send initial sync data to a newly connected client
 */
export function sendInitialSync(npub: string, data: unknown): void {
  const client = connectedClients.get(npub);
  if (client) {
    sendToClient(client, {
      type: "sync:init",
      data,
    });
  }
}

/**
 * Get count of connected clients (for monitoring)
 */
export function getConnectedCount(): number {
  return connectedClients.size;
}

/**
 * Send a heartbeat/ping to keep connections alive
 */
export function sendHeartbeat(): void {
  const encoder = new TextEncoder();
  const heartbeat = encoder.encode(": heartbeat\n\n");

  const failedClients: string[] = [];

  for (const [npub, client] of connectedClients) {
    try {
      client.controller.enqueue(heartbeat);
    } catch {
      failedClients.push(npub);
    }
  }

  // Clean up failed connections
  for (const npub of failedClients) {
    unregisterClient(npub);
  }
}

// Send heartbeat every 30 seconds to keep connections alive
setInterval(sendHeartbeat, 30000);
