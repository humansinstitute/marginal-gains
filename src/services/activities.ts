/**
 * Activity creation and broadcasting service
 *
 * Centralizes activity creation to avoid duplication across route handlers.
 * Each activity is persisted to the team DB and broadcast via SSE.
 */

import { TeamDatabase } from "../team-db";

import { broadcast } from "./events";

import type { Activity } from "../team-db";
import type { Database } from "bun:sqlite";

interface CreateActivityParams {
  targetNpub: string;
  type: Activity["type"];
  sourceNpub: string;
  messageId?: number | null;
  channelId?: number | null;
  todoId?: number | null;
  summary?: string;
}

/**
 * Create an activity and broadcast it via SSE.
 * Skips if source === target (no self-notifications).
 */
export function createAndBroadcastActivity(
  teamSlug: string,
  teamDb: Database,
  params: CreateActivityParams
): Activity | null {
  // No self-notifications
  if (params.sourceNpub === params.targetNpub) return null;

  const db = new TeamDatabase(teamDb);
  const activity = db.createActivity(params);

  if (activity) {
    broadcast(teamSlug, teamDb, {
      type: "activity:new",
      data: activity,
      recipientNpubs: [params.targetNpub],
    });
  }

  return activity;
}
