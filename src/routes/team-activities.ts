/**
 * Team-scoped Activities API
 *
 * GET  /t/:slug/api/activities       - List activities for authenticated user
 * POST /t/:slug/api/activities/read  - Mark activities as read
 *
 * Works with both cookie auth (browser) and NIP-98 auth (bots).
 */

import { createTeamRouteContext } from "../context";
import { TeamDatabase } from "../team-db";

import type { Session } from "../types";

const jsonHeaders = { "Content-Type": "application/json" };

export function handleTeamGetActivities(
  session: Session | null,
  teamSlug: string,
  url: URL
): Response {
  const result = createTeamRouteContext(session, teamSlug, { isApi: true });
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  const since = url.searchParams.get("since") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  let limit = limitParam ? Number(limitParam) : 50;
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  const activities = db.listActivities(ctx.session.npub, limit, since);
  const unreadCount = db.getUnreadActivityCount(ctx.session.npub);

  return new Response(JSON.stringify({ activities, unreadCount }), {
    status: 200,
    headers: jsonHeaders,
  });
}

export async function handleTeamMarkActivitiesRead(
  req: Request,
  session: Session | null,
  teamSlug: string
): Promise<Response> {
  const result = createTeamRouteContext(session, teamSlug, { isApi: true });
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  let body: { id?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body = mark all
  }

  if (typeof body.id === "number") {
    db.markActivityRead(body.id, ctx.session.npub);
  } else {
    db.markAllActivitiesRead(ctx.session.npub);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: jsonHeaders,
  });
}
