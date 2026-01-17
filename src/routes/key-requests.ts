/**
 * Key Request Routes
 *
 * Handles encryption key distribution for new team members:
 * - GET /t/:slug/api/key-requests - List user's own requests
 * - GET /t/:slug/api/key-requests/pending - List requests to fulfill (managers)
 * - POST /t/:slug/api/key-requests/:id/fulfill - Fulfill with wrapped key
 * - POST /t/:slug/api/key-requests/:id/reject - Reject request
 */

import { getTeamDb } from "../db-router";
import { jsonResponse, unauthorized, forbidden } from "../http";
import { isUserTeamManager } from "../master-db";
import { broadcast } from "../services/events";
import { TeamDatabase } from "../team-db";

import type { Session } from "../types";

// ============================================================================
// List Own Key Requests
// ============================================================================

/**
 * GET /t/:slug/api/key-requests
 * List the current user's pending key requests
 */
export function handleListOwnKeyRequests(
  session: Session | null,
  teamSlug: string
): Response {
  if (!session) {
    return unauthorized();
  }

  try {
    const teamDb = new TeamDatabase(getTeamDb(teamSlug));
    const requests = teamDb.listKeyRequestsByRequester(session.npub);

    // Enrich with channel info
    const enriched = requests.map((req) => {
      const channel = teamDb.getChannel(req.channel_id);
      return {
        ...req,
        channel_name: channel?.name || `Channel ${req.channel_id}`,
        channel_slug: channel?.slug || null,
      };
    });

    return jsonResponse({ requests: enriched });
  } catch (err) {
    console.error("[KeyRequests] Error listing own requests:", err);
    return jsonResponse({ error: "Failed to list key requests" }, 500);
  }
}

// ============================================================================
// List Pending Key Requests (Managers)
// ============================================================================

/**
 * GET /t/:slug/api/key-requests/pending
 * List pending key requests that the current user can fulfill
 * (requests where they are the target - i.e., from invites they created)
 */
export function handleListPendingKeyRequests(
  session: Session | null,
  teamSlug: string
): Response {
  if (!session) {
    return unauthorized();
  }

  try {
    const teamDb = new TeamDatabase(getTeamDb(teamSlug));
    const requests = teamDb.listPendingKeyRequests(session.npub);

    // Enrich with channel and requester info
    const enriched = requests.map((req) => {
      const channel = teamDb.getChannel(req.channel_id);
      const user = teamDb.getUserByNpub(req.requester_npub);
      return {
        ...req,
        channel_name: channel?.name || `Channel ${req.channel_id}`,
        channel_slug: channel?.slug || null,
        requester_display_name: user?.display_name || req.requester_npub.slice(0, 12) + "...",
      };
    });

    return jsonResponse({ requests: enriched });
  } catch (err) {
    console.error("[KeyRequests] Error listing pending requests:", err);
    return jsonResponse({ error: "Failed to list pending key requests" }, 500);
  }
}

// ============================================================================
// Fulfill Key Request
// ============================================================================

/**
 * POST /t/:slug/api/key-requests/:id/fulfill
 * Fulfill a key request with a wrapped encryption key
 *
 * Body: { encryptedKey: string, keyVersion?: number }
 */
export async function handleFulfillKeyRequest(
  req: Request,
  session: Session | null,
  teamSlug: string,
  requestId: number
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  try {
    const body = await req.json();
    const { encryptedKey, keyVersion = 1 } = body as {
      encryptedKey?: string;
      keyVersion?: number;
    };

    if (!encryptedKey) {
      return jsonResponse({ error: "encryptedKey is required" }, 400);
    }

    const teamDb = new TeamDatabase(getTeamDb(teamSlug));

    // Get the request
    const keyRequest = teamDb.getKeyRequest(requestId);
    if (!keyRequest) {
      return jsonResponse({ error: "Key request not found" }, 404);
    }

    // Verify the current user is the target (authorized to fulfill)
    if (keyRequest.target_npub !== session.npub) {
      // Also allow team managers to fulfill any request
      if (!isUserTeamManager(session.currentTeamId || 0, session.npub)) {
        return forbidden();
      }
    }

    // Verify request is still pending
    if (keyRequest.status !== "pending") {
      return jsonResponse({ error: `Request already ${keyRequest.status}` }, 400);
    }

    // Store the wrapped key for the requester (using hex pubkey, not npub)
    teamDb.storeUserChannelKey(
      keyRequest.requester_pubkey,
      keyRequest.channel_id,
      encryptedKey,
      keyVersion
    );

    // Mark request as fulfilled
    teamDb.fulfillKeyRequest(requestId, session.npub);

    console.log(
      `[KeyRequests] Fulfilled request ${requestId} for ${keyRequest.requester_npub.slice(0, 12)}... channel ${keyRequest.channel_id}`
    );

    // Notify the requester via SSE
    const db = getTeamDb(teamSlug);
    broadcast(teamSlug, db, {
      type: "key_request:fulfilled",
      data: {
        requestId,
        channelId: keyRequest.channel_id,
        fulfilledBy: session.npub,
      },
    });

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[KeyRequests] Error fulfilling request:", err);
    return jsonResponse({ error: "Failed to fulfill key request" }, 500);
  }
}

// ============================================================================
// Reject Key Request
// ============================================================================

/**
 * POST /t/:slug/api/key-requests/:id/reject
 * Reject a key request
 */
export function handleRejectKeyRequest(
  _req: Request,
  session: Session | null,
  teamSlug: string,
  requestId: number
): Response {
  if (!session) {
    return unauthorized();
  }

  try {
    const teamDb = new TeamDatabase(getTeamDb(teamSlug));

    // Get the request
    const keyRequest = teamDb.getKeyRequest(requestId);
    if (!keyRequest) {
      return jsonResponse({ error: "Key request not found" }, 404);
    }

    // Verify the current user is the target (authorized to reject)
    if (keyRequest.target_npub !== session.npub) {
      // Also allow team managers to reject any request
      if (!isUserTeamManager(session.currentTeamId || 0, session.npub)) {
        return forbidden();
      }
    }

    // Verify request is still pending
    if (keyRequest.status !== "pending") {
      return jsonResponse({ error: `Request already ${keyRequest.status}` }, 400);
    }

    // Mark request as rejected
    teamDb.rejectKeyRequest(requestId);

    console.log(
      `[KeyRequests] Rejected request ${requestId} for ${keyRequest.requester_npub.slice(0, 12)}...`
    );

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[KeyRequests] Error rejecting request:", err);
    return jsonResponse({ error: "Failed to reject key request" }, 500);
  }
}
