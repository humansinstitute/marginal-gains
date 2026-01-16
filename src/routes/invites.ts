/**
 * Invite Routes
 *
 * Handles team invite onboarding flow:
 * - GET /api/invites/preview - Preview invite details (no auth)
 * - POST /api/invites/redeem - Redeem invite and join team (auth required)
 * - POST /api/invites/keys - Store user-wrapped keys after re-encryption (auth required)
 */

import { createHash } from "crypto";

import { getTeamDb } from "../db-router";
import { jsonResponse, unauthorized } from "../http";
import {
  getTeam,
  getTeamInvitationByCode,
  getInviteGroups,
  redeemTeamInvitation,
  isUserTeamMember,
  getUserTeams,
} from "../master-db";
import { renderOnboardingPage } from "../render/onboard";
import { broadcast } from "../services/events";
import { TeamDatabase } from "../team-db";

import type { InvitePreview } from "../render/onboard";
import type { Session } from "../types";

// ============================================================================
// Preview Invite (Public)
// ============================================================================

/**
 * GET /api/invites/preview?code={code}
 * Returns invite details without consuming it
 */
export function handlePreviewInvite(url: URL): Response {
  const code = url.searchParams.get("code");

  if (!code) {
    return jsonResponse({ valid: false, error: "No invite code provided" }, 400);
  }

  const preview = getInvitePreview(code);
  return jsonResponse(preview);
}

/**
 * Build preview data for an invite code
 */
export function getInvitePreview(code: string, userNpub?: string): InvitePreview {
  const invitation = getTeamInvitationByCode(code);

  if (!invitation) {
    return { valid: false, error: "Invalid invite code" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (invitation.expires_at < now) {
    return { valid: false, error: "This invite has expired" };
  }

  if (invitation.single_use && invitation.redeemed_count > 0) {
    return { valid: false, error: "This invite has already been used" };
  }

  const team = getTeam(invitation.team_id);
  if (!team || !team.is_active) {
    return { valid: false, error: "Team no longer exists" };
  }

  // Check if user is already a member
  const alreadyMember = userNpub ? isUserTeamMember(team.id, userNpub) : false;

  // Get groups associated with this invite
  const inviteGroupsList = getInviteGroups(invitation.id);
  let groups: Array<{ id: number; name: string }> = [];

  if (inviteGroupsList.length > 0) {
    try {
      const teamDb = new TeamDatabase(getTeamDb(team.slug));
      groups = inviteGroupsList.map((ig) => {
        const group = teamDb.getGroup(ig.group_id);
        return {
          id: ig.group_id,
          name: group?.name || `Group ${ig.group_id}`,
        };
      });
    } catch {
      // Team DB might not exist yet, skip groups
    }
  }

  return {
    valid: true,
    team: {
      id: team.id,
      slug: team.slug,
      displayName: team.display_name,
      description: team.description,
    },
    groups,
    role: invitation.role as "owner" | "manager" | "member",
    alreadyMember,
  };
}

// ============================================================================
// Render Onboarding Page
// ============================================================================

/**
 * GET /?code={code} - Render onboarding page
 */
export function handleOnboardingPage(session: Session | null, code: string): Response {
  const preview = getInvitePreview(code, session?.npub);

  // If already a member, redirect to team chat
  if (preview.alreadyMember && preview.team) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/t/${preview.team.slug}/chat` },
    });
  }

  const html = renderOnboardingPage({
    inviteCode: code,
    preview,
    isLoggedIn: !!session,
    userNpub: session?.npub,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

// ============================================================================
// Redeem Invite
// ============================================================================

/**
 * POST /api/invites/redeem
 * Redeem an invite and join the team
 */
export async function handleRedeemInvite(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const body = await req.json();
  const { code } = body as { code?: string };

  if (!code) {
    return jsonResponse({ success: false, error: "Invite code is required" }, 400);
  }

  // Get full invite details before redemption
  const invitation = getTeamInvitationByCode(code);
  if (!invitation) {
    return jsonResponse({ success: false, error: "Invalid invite code" }, 400);
  }

  const team = getTeam(invitation.team_id);
  if (!team) {
    return jsonResponse({ success: false, error: "Team not found" }, 404);
  }

  // Check if already a member
  if (isUserTeamMember(team.id, session.npub)) {
    return jsonResponse({
      success: true,
      alreadyMember: true,
      team: {
        id: team.id,
        slug: team.slug,
        displayName: team.display_name,
      },
    });
  }

  // Redeem the invitation (adds to team_memberships)
  const result = redeemTeamInvitation(code, session.npub);
  if (!result.success) {
    return jsonResponse({ success: false, error: result.error }, 400);
  }

  // Get groups associated with invite
  const inviteGroupsList = getInviteGroups(invitation.id);
  console.log(`[Invites] Invite ${invitation.id} has ${inviteGroupsList.length} groups:`, inviteGroupsList);

  // Add user to the groups specified in the invite
  let keyRequestsCreated = 0;
  if (inviteGroupsList.length > 0) {
    try {
      const db = getTeamDb(team.slug);
      const teamDb = new TeamDatabase(db);

      // Hash the invite code for tracking
      const codeHash = createHash("sha256").update(code).digest("hex").slice(0, 16);

      for (const ig of inviteGroupsList) {
        console.log(`[Invites] Adding user ${session.npub.slice(0, 12)}... to group ${ig.group_id}`);
        teamDb.addGroupMember(ig.group_id, session.npub);

        // Create key requests for encrypted channels in this group
        const encryptedChannels = teamDb.getEncryptedChannelsForGroup(ig.group_id);
        for (const channel of encryptedChannels) {
          const created = teamDb.createKeyRequest({
            channelId: channel.id,
            requesterNpub: session.npub,
            requesterPubkey: session.pubkey || "",
            targetNpub: invitation.created_by,
            inviteCodeHash: codeHash,
            groupId: ig.group_id,
          });
          if (created) {
            keyRequestsCreated++;
            console.log(`[Invites] Created key request for channel ${channel.id} (${channel.name})`);
          }
        }
      }
      console.log(`[Invites] Successfully added user to ${inviteGroupsList.length} groups`);

      // Notify the invite creator via SSE if any key requests were created
      if (keyRequestsCreated > 0) {
        console.log(`[Invites] Created ${keyRequestsCreated} key requests, notifying ${invitation.created_by.slice(0, 12)}...`);
        broadcast(team.slug, db, {
          type: "key_request:new",
          data: {
            requesterNpub: session.npub,
            count: keyRequestsCreated,
          },
        });
      }
    } catch (err) {
      console.error("[Invites] Error adding user to groups:", err);
    }
  } else {
    console.log("[Invites] No groups associated with this invite");
  }

  // Update session with new team memberships
  session.teamMemberships = getUserTeams(session.npub);

  // If user has no current team, auto-select this one
  if (!session.currentTeamId) {
    session.currentTeamId = team.id;
    session.currentTeamSlug = team.slug;
  }

  return jsonResponse({
    success: true,
    team: {
      id: team.id,
      slug: team.slug,
      displayName: team.display_name,
    },
    // Team key for decryption if needed
    encryptedTeamKey: invitation.encrypted_team_key || null,
  });
}

// ============================================================================
// Store User Keys
// ============================================================================

/**
 * POST /api/invites/keys
 * Store user-wrapped keys after client-side re-encryption
 */
export async function handleStoreInviteKeys(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const body = await req.json();
  const { teamSlug, teamKey, channelKeys } = body as {
    teamSlug?: string;
    teamKey?: string;
    channelKeys?: Array<{ channelId: number; encryptedKey: string }>;
  };

  if (!teamSlug) {
    return jsonResponse({ success: false, error: "teamSlug is required" }, 400);
  }

  try {
    const teamDb = new TeamDatabase(getTeamDb(teamSlug));

    // Store team key
    if (teamKey) {
      teamDb.storeUserTeamKey(session.npub, teamKey, session.npub);
    }

    // Store channel keys
    if (channelKeys && channelKeys.length > 0) {
      for (const ck of channelKeys) {
        // Key version 1 for new keys from invites
        teamDb.storeUserChannelKey(session.npub, ck.channelId, ck.encryptedKey, 1);
      }
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[Invites] Error storing keys:", err);
    return jsonResponse({ success: false, error: "Failed to store keys" }, 500);
  }
}
