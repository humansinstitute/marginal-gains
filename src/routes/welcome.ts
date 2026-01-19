/**
 * Welcome Integration Routes
 *
 * Endpoints for integrating with Welcome's user groups and invite code system.
 */

import { jsonResponse } from "../http";
import { getUserGroups, getUserInviteCode } from "../services/welcome-api";

import type { Session } from "../types";

/**
 * GET /api/welcome/groups
 *
 * Get the current user's groups from Welcome.
 * Requires authentication.
 */
export async function handleGetWelcomeGroups(session: Session | null): Promise<Response> {
  if (!session) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  const result = await getUserGroups(session.npub);

  if (!result.success) {
    return jsonResponse({ error: result.error }, 502);
  }

  return jsonResponse({
    success: true,
    groups: result.groups ?? [],
  });
}

/**
 * GET /api/welcome/invite-code
 *
 * Get the MG invite code linked to the current user's Welcome account.
 * This is used to auto-join teams after key teleport.
 *
 * Requires authentication.
 */
export async function handleGetWelcomeInviteCode(session: Session | null): Promise<Response> {
  if (!session) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  const result = await getUserInviteCode(session.npub);

  if (!result.success) {
    return jsonResponse({ error: result.error }, 502);
  }

  return jsonResponse({
    success: true,
    invite_code: result.invite_code ?? null,
  });
}
