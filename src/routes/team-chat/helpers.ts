/**
 * Shared helpers and imports for team-chat route handlers
 */

import { createTeamRouteContext } from "../../context";
import { jsonResponse } from "../../http";

import type { TeamContextResult } from "../../context";
import type { Session } from "../../types";

export function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

/**
 * Helper to get team context or return error response
 */
export function requireTeamContext(
  session: Session | null,
  teamSlug: string,
  returnPath?: string
): TeamContextResult {
  return createTeamRouteContext(session, teamSlug, returnPath);
}
