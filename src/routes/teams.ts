/**
 * Team Management Routes
 *
 * Handles all team-related operations:
 * - List user's teams
 * - Create new team
 * - Switch teams
 * - Join team via invite
 * - Team settings (for managers)
 */

import { createHash } from "crypto";

import { nip19 } from "nostr-tools";

import { isAdmin } from "../config";
import { updateSession } from "../db";
import { getTeamDb } from "../db-router";
import { jsonResponse, forbidden, unauthorized } from "../http";
import {
  createTeam,
  getTeam,
  getTeamBySlug,
  getTeamInvitationByCode,
  getInviteGroups,
  updateTeam,
  deactivateTeam,
  getUserTeams,
  addTeamMember,
  getTeamMembers,
  removeTeamMember,
  updateTeamMemberRole,
  createTeamInvitation,
  getTeamInvitations,
  redeemTeamInvitation,
  deleteTeamInvitation,
  isUserTeamMember,
  isUserTeamManager,
  isUserTeamOwner,
  canUserCreateTeams,
  addTeamManager,
  listTeamManagers,
  isTeamSlugAvailable,
  addInviteGroups,
} from "../master-db";
import { renderTeamsPage, renderTeamSettingsPage } from "../render/teams";
import { broadcast } from "../services/events";
import { TeamDatabase } from "../team-db";
import { isValidImage, processImageFromFile } from "../utils/images";

import type { InviteGroupOption } from "../render/teams";
import type { Session } from "../types";

// ============================================================================
// Helper to persist session team data
// ============================================================================

function persistSessionTeamData(session: Session) {
  const teamMemberships = session.teamMemberships ? JSON.stringify(session.teamMemberships) : null;
  updateSession(
    session.token,
    session.currentTeamId ?? null,
    session.currentTeamSlug ?? null,
    teamMemberships
  );
}

// ============================================================================
// Team List & Selection
// ============================================================================

/**
 * GET /teams - Teams list/selection page
 *
 * Auto-redirects to chat if user has exactly one team (unless ?manage=1)
 */
export function handleTeamsPage(session: Session | null, url?: URL): Response {
  if (!session) {
    // Build return path with query params
    const returnPath = url ? `/teams${url.search}` : "/teams";
    const encodedReturn = encodeURIComponent(returnPath);
    return new Response(null, {
      status: 302,
      headers: { Location: `/?return=${encodedReturn}` },
    });
  }

  const teams = getUserTeams(session.npub);
  const forceManage = url?.searchParams.get("manage") === "1";

  // Auto-redirect if user has exactly one team (unless explicitly managing)
  if (teams.length === 1 && !forceManage) {
    const team = teams[0];
    // Set team context in session
    session.currentTeamId = team.teamId;
    session.currentTeamSlug = team.teamSlug;
    session.teamMemberships = teams;
    persistSessionTeamData(session);

    return new Response(null, {
      status: 302,
      headers: { Location: `/t/${team.teamSlug}/chat` },
    });
  }

  return new Response(renderTeamsPage(session, teams), {
    headers: { "Content-Type": "text/html" },
  });
}

/**
 * GET /api/teams - List user's teams (JSON)
 */
export function handleListTeams(session: Session | null): Response {
  if (!session) {
    return unauthorized();
  }

  const teams = getUserTeams(session.npub);
  const canCreate = isAdmin(session.npub) || canUserCreateTeams(session.npub);

  return jsonResponse({ teams, canCreate });
}

/**
 * POST /teams/switch - Switch to a different team
 */
export async function handleSwitchTeam(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const body = await req.json();
  const { teamSlug } = body as { teamSlug?: string };

  if (!teamSlug) {
    return jsonResponse({ error: "teamSlug is required" }, 400);
  }

  const team = getTeamBySlug(teamSlug);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a member (super-admins can access any team)
  if (!isAdmin(session.npub) && !isUserTeamMember(team.id, session.npub)) {
    return forbidden("You are not a member of this team");
  }

  // Update session with new team context
  session.currentTeamId = team.id;
  session.currentTeamSlug = team.slug;

  // Re-fetch memberships to ensure they're current
  session.teamMemberships = getUserTeams(session.npub);
  persistSessionTeamData(session);

  return jsonResponse({
    success: true,
    team: {
      id: team.id,
      slug: team.slug,
      displayName: team.display_name,
      iconUrl: team.icon_url,
    },
  });
}

// ============================================================================
// Team Creation
// ============================================================================

/**
 * POST /teams - Create a new team
 */
export async function handleCreateTeam(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  // Check if user can create teams
  if (!isAdmin(session.npub) && !canUserCreateTeams(session.npub)) {
    return forbidden("You do not have permission to create teams");
  }

  const body = await req.json();
  const { slug, displayName, description, iconUrl } = body as {
    slug?: string;
    displayName?: string;
    description?: string;
    iconUrl?: string;
  };

  if (!slug || !displayName) {
    return jsonResponse({ error: "slug and displayName are required" }, 400);
  }

  // Validate slug format
  const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  if (slug.length < 3 || slug.length > 32 || !slugPattern.test(slug)) {
    return jsonResponse(
      { error: "Slug must be 3-32 characters, lowercase alphanumeric with hyphens, cannot start/end with hyphen" },
      400
    );
  }

  // Check if slug is available
  if (!isTeamSlugAvailable(slug)) {
    return jsonResponse({ error: "This team URL is already taken" }, 409);
  }

  try {
    const team = createTeam(slug, displayName, description || "", session.npub, iconUrl);

    // Add creator as owner
    addTeamMember(team.id, session.npub, "owner");

    // Update session with new team
    session.currentTeamId = team.id;
    session.currentTeamSlug = team.slug;
    session.teamMemberships = getUserTeams(session.npub);
    persistSessionTeamData(session);

    return jsonResponse({
      success: true,
      team: {
        id: team.id,
        slug: team.slug,
        displayName: team.display_name,
      },
    });
  } catch (error) {
    console.error("Failed to create team:", error);
    return jsonResponse({ error: "Failed to create team" }, 500);
  }
}

// ============================================================================
// Team Join via Invite
// ============================================================================

/**
 * POST /teams/join - Join a team via invite code
 */
export async function handleJoinTeam(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const body = await req.json();
  const { code } = body as { code?: string };

  if (!code) {
    return jsonResponse({ error: "Invite code is required" }, 400);
  }

  // Get full invite details before redemption (needed for group lookup)
  const invitation = getTeamInvitationByCode(code);
  if (!invitation) {
    return jsonResponse({ error: "Invalid invite code" }, 400);
  }

  const team = getTeam(invitation.team_id);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
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

  const result = redeemTeamInvitation(code, session.npub);

  if (!result.success) {
    return jsonResponse({ error: result.error }, 400);
  }

  // Get groups associated with invite and add user to them
  const inviteGroupsList = getInviteGroups(invitation.id);
  console.log(`[Teams/Join] Invite ${invitation.id} has ${inviteGroupsList.length} groups:`, inviteGroupsList);

  let keyRequestsCreated = 0;
  if (inviteGroupsList.length > 0) {
    try {
      const db = getTeamDb(team.slug);
      const teamDb = new TeamDatabase(db);

      // Hash the invite code for tracking
      const codeHash = createHash("sha256").update(code).digest("hex").slice(0, 16);

      // Get hex pubkey - use session.pubkey if available, otherwise decode from npub
      let requesterPubkey = session.pubkey || "";
      if (!requesterPubkey && session.npub) {
        try {
          const decoded = nip19.decode(session.npub);
          if (decoded.type === "npub") {
            requesterPubkey = decoded.data;
          }
        } catch (e) {
          console.warn("[Teams/Join] Failed to decode npub:", e);
        }
      }

      for (const ig of inviteGroupsList) {
        console.log(`[Teams/Join] Adding user ${session.npub.slice(0, 12)}... to group ${ig.group_id}`);
        teamDb.addGroupMember(ig.group_id, session.npub);

        // Create key requests for encrypted channels in this group
        const encryptedChannels = teamDb.getEncryptedChannelsForGroup(ig.group_id);
        for (const channel of encryptedChannels) {
          const created = teamDb.createKeyRequest({
            channelId: channel.id,
            requesterNpub: session.npub,
            requesterPubkey,
            targetNpub: invitation.created_by,
            inviteCodeHash: codeHash,
            groupId: ig.group_id,
          });
          if (created) {
            keyRequestsCreated++;
            console.log(`[Teams/Join] Created key request for channel ${channel.id} (${channel.name})`);
          }
        }
      }
      console.log(`[Teams/Join] Successfully added user to ${inviteGroupsList.length} groups`);

      // Notify the invite creator via SSE if any key requests were created
      if (keyRequestsCreated > 0) {
        console.log(`[Teams/Join] Created ${keyRequestsCreated} key requests, notifying ${invitation.created_by.slice(0, 12)}...`);
        broadcast(team.slug, db, {
          type: "key_request:new",
          data: {
            requesterNpub: session.npub,
            count: keyRequestsCreated,
          },
        });
      }
    } catch (err) {
      console.error("[Teams/Join] Error adding user to groups:", err);
    }
  } else {
    console.log("[Teams/Join] No groups associated with this invite");
  }

  // Update session with new team memberships
  session.teamMemberships = getUserTeams(session.npub);

  // If user has no current team, auto-select this one
  if (!session.currentTeamId && result.team) {
    session.currentTeamId = result.team.id;
    session.currentTeamSlug = result.team.slug;
  }

  persistSessionTeamData(session);

  return jsonResponse({
    success: true,
    team: result.team
      ? {
          id: result.team.id,
          slug: result.team.slug,
          displayName: result.team.display_name,
        }
      : null,
  });
}

/**
 * GET /teams/join/:code - Join team page (for link sharing)
 */
export function handleJoinTeamPage(session: Session | null, code: string): Response {
  // This would render a page that shows the team info and a "Join" button
  // For now, redirect to teams page with the code as a query param
  const redirectUrl = session ? `/teams?join=${encodeURIComponent(code)}` : `/auth/login?redirect=/teams/join/${code}`;
  return Response.redirect(redirectUrl, 302);
}

// ============================================================================
// Team Settings (Managers Only)
// ============================================================================

/**
 * GET /t/:slug/settings - Team settings page
 */
export function handleTeamSettingsPage(session: Session | null, teamSlug: string): Response {
  if (!session) {
    const returnPath = encodeURIComponent(`/t/${teamSlug}/settings`);
    return new Response(null, {
      status: 302,
      headers: { Location: `/?return=${returnPath}` },
    });
  }

  const team = getTeamBySlug(teamSlug);
  if (!team) {
    return new Response("Team not found", { status: 404 });
  }

  // Check if user is a manager or super-admin
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to manage this team");
  }

  const members = getTeamMembers(team.id);
  const invitations = getTeamInvitations(team.id);
  const isOwner = isUserTeamOwner(team.id, session.npub) || isAdmin(session.npub);

  // Fetch groups for the invite modal
  let groups: InviteGroupOption[] = [];
  try {
    const teamDb = new TeamDatabase(getTeamDb(teamSlug));
    const allGroups = teamDb.listGroups();
    console.log("[Teams] Settings page - found", allGroups.length, "groups for invite modal:", allGroups.map(g => g.name));
    groups = allGroups.map((g) => ({
      id: g.id,
      name: g.name,
    }));
  } catch (err) {
    console.log("[Teams] Settings page - error fetching groups:", err);
    // Team DB might not exist yet, continue without groups
  }

  return new Response(renderTeamSettingsPage(session, team, members, invitations, isOwner, groups), {
    headers: { "Content-Type": "text/html" },
  });
}

/**
 * PATCH /api/teams/:id - Update team settings
 */
export async function handleUpdateTeam(
  req: Request,
  session: Session | null,
  teamId: number
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a manager or super-admin
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to update this team");
  }

  const body = await req.json();
  const { displayName, description, iconUrl } = body as {
    displayName?: string;
    description?: string;
    iconUrl?: string;
  };

  const updated = updateTeam(teamId, { displayName, description, iconUrl });
  if (!updated) {
    return jsonResponse({ error: "Failed to update team" }, 500);
  }

  // Update session if this is the current team
  if (session.currentTeamId === teamId && displayName) {
    const membership = session.teamMemberships?.find((m) => m.teamId === teamId);
    if (membership) {
      membership.displayName = displayName;
    }
  }

  return jsonResponse({ success: true, team: updated });
}

/**
 * PATCH /api/teams/:id/features - Update team feature visibility
 */
export async function handleUpdateTeamFeatures(
  req: Request,
  session: Session | null,
  teamId: number
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a manager or super-admin
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to update team features");
  }

  const body = await req.json();
  const { hideTasks, hideCrm } = body as {
    hideTasks?: boolean;
    hideCrm?: boolean;
  };

  const { updateTeamFeatureVisibility } = await import("../master-db");
  const updated = updateTeamFeatureVisibility(teamId, { hideTasks, hideCrm });
  if (!updated) {
    return jsonResponse({ error: "Failed to update team features" }, 500);
  }

  return jsonResponse({ success: true, team: updated });
}

/**
 * DELETE /api/teams/:id - Deactivate/delete team
 */
export function handleDeleteTeam(session: Session | null, teamId: number): Response {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Only owner or super-admin can delete
  if (!isAdmin(session.npub) && !isUserTeamOwner(team.id, session.npub)) {
    return forbidden("Only the team owner can delete this team");
  }

  const success = deactivateTeam(teamId);
  if (!success) {
    return jsonResponse({ error: "Failed to delete team" }, 500);
  }

  // If this was the current team, clear it from session
  if (session.currentTeamId === teamId) {
    session.currentTeamId = null;
    session.currentTeamSlug = null;
  }

  // Remove from session memberships
  if (session.teamMemberships) {
    session.teamMemberships = session.teamMemberships.filter((m) => m.teamId !== teamId);
  }

  persistSessionTeamData(session);

  return jsonResponse({ success: true });
}

// ============================================================================
// Team Member Management
// ============================================================================

/**
 * GET /api/teams/:id/members - List team members
 */
export function handleListTeamMembers(session: Session | null, teamId: number): Response {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check access
  if (!isAdmin(session.npub) && !isUserTeamMember(team.id, session.npub)) {
    return forbidden("You are not a member of this team");
  }

  const members = getTeamMembers(teamId);
  return jsonResponse({ members });
}

/**
 * POST /api/teams/:id/members - Add team member
 */
export async function handleAddTeamMember(
  req: Request,
  session: Session | null,
  teamId: number
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a manager
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to add members");
  }

  const body = await req.json();
  const { npub, role } = body as { npub?: string; role?: "owner" | "manager" | "member" };

  if (!npub) {
    return jsonResponse({ error: "npub is required" }, 400);
  }

  // Validate npub format
  if (!npub.startsWith("npub1") || npub.length !== 63) {
    return jsonResponse({ error: "Invalid npub format" }, 400);
  }

  // Only owners can add other owners/managers
  if ((role === "owner" || role === "manager") && !isAdmin(session.npub) && !isUserTeamOwner(team.id, session.npub)) {
    return forbidden("Only team owners can assign owner or manager roles");
  }

  const membership = addTeamMember(teamId, npub, role || "member", session.npub);
  if (!membership) {
    return jsonResponse({ error: "User is already a member" }, 409);
  }

  return jsonResponse({ success: true, membership });
}

/**
 * PATCH /api/teams/:id/members/:npub - Update member role
 */
export async function handleUpdateTeamMember(
  req: Request,
  session: Session | null,
  teamId: number,
  memberNpub: string
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Only owners can change roles
  if (!isAdmin(session.npub) && !isUserTeamOwner(team.id, session.npub)) {
    return forbidden("Only team owners can change member roles");
  }

  const body = await req.json();
  const { role } = body as { role?: "owner" | "manager" | "member" };

  if (!role) {
    return jsonResponse({ error: "role is required" }, 400);
  }

  const success = updateTeamMemberRole(teamId, memberNpub, role);
  if (!success) {
    return jsonResponse({ error: "Member not found" }, 404);
  }

  return jsonResponse({ success: true });
}

/**
 * DELETE /api/teams/:id/members/:npub - Remove team member
 */
export function handleRemoveTeamMember(
  session: Session | null,
  teamId: number,
  memberNpub: string
): Response {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Users can remove themselves, managers can remove members
  const isSelf = session.npub === memberNpub;
  if (!isSelf && !isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to remove members");
  }

  // Prevent removing the last owner
  if (isUserTeamOwner(team.id, memberNpub)) {
    const members = getTeamMembers(teamId);
    const ownerCount = members.filter((m) => m.role === "owner").length;
    if (ownerCount <= 1) {
      return jsonResponse({ error: "Cannot remove the last owner. Transfer ownership first." }, 400);
    }
  }

  const success = removeTeamMember(teamId, memberNpub);
  if (!success) {
    return jsonResponse({ error: "Member not found" }, 404);
  }

  return jsonResponse({ success: true });
}

// ============================================================================
// Team Invitations
// ============================================================================

/**
 * GET /api/teams/:id/invitations - List team invitations
 */
export function handleListTeamInvitations(session: Session | null, teamId: number): Response {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a manager
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to view invitations");
  }

  const invitations = getTeamInvitations(teamId);
  return jsonResponse({ invitations });
}

/**
 * POST /api/teams/:id/invitations - Create invitation
 */
export async function handleCreateTeamInvitation(
  req: Request,
  session: Session | null,
  teamId: number
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a manager
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to create invitations");
  }

  const body = await req.json();
  console.log("[Teams] Create invite request body:", JSON.stringify(body));
  const { role, singleUse, expiresInHours, groupIds, label } = body as {
    role?: "owner" | "manager" | "member";
    singleUse?: boolean;
    expiresInHours?: number;
    groupIds?: number[];
    label?: string;
  };
  console.log("[Teams] Parsed groupIds:", groupIds, "label:", label);

  // Only owners can create owner/manager invites
  if ((role === "owner" || role === "manager") && !isAdmin(session.npub) && !isUserTeamOwner(team.id, session.npub)) {
    return forbidden("Only team owners can create owner or manager invitations");
  }

  const { code, invitation } = createTeamInvitation(
    teamId,
    session.npub,
    role || "member",
    singleUse !== false,
    expiresInHours || 168,
    label?.trim() || null
  );

  // Add groups to the invitation if provided
  if (groupIds && groupIds.length > 0) {
    addInviteGroups(invitation.id, groupIds);
  }

  // Construct the full invite URL - using new format with query string
  // Always use HTTPS for invite URLs (server may be behind a reverse proxy)
  const url = new URL(req.url);
  const origin = url.origin.replace(/^http:/, "https:");
  const inviteUrl = `${origin}/?code=${code}`;

  return jsonResponse({
    success: true,
    code,
    invitation,
    inviteUrl,
  });
}

/**
 * DELETE /api/teams/:id/invitations/:inviteId - Delete invitation
 */
export function handleDeleteTeamInvitation(
  session: Session | null,
  teamId: number,
  inviteId: number
): Response {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a manager
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to delete invitations");
  }

  const success = deleteTeamInvitation(inviteId);
  if (!success) {
    return jsonResponse({ error: "Invitation not found" }, 404);
  }

  return jsonResponse({ success: true });
}

// ============================================================================
// Team Managers (Super Admin Only)
// ============================================================================

/**
 * GET /api/team-managers - List team managers (super admin only)
 */
export function handleListTeamManagers(session: Session | null): Response {
  if (!session) {
    return unauthorized();
  }

  if (!isAdmin(session.npub)) {
    return forbidden("Super admin access required");
  }

  const managers = listTeamManagers();
  return jsonResponse({ managers });
}

/**
 * POST /api/team-managers - Add team manager (super admin only)
 */
export async function handleAddTeamManager(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  if (!isAdmin(session.npub)) {
    return forbidden("Super admin access required");
  }

  const body = await req.json();
  const { npub } = body as { npub?: string };

  if (!npub) {
    return jsonResponse({ error: "npub is required" }, 400);
  }

  if (!npub.startsWith("npub1") || npub.length !== 63) {
    return jsonResponse({ error: "Invalid npub format" }, 400);
  }

  const success = addTeamManager(npub, session.npub);
  if (!success) {
    return jsonResponse({ error: "Failed to add team manager" }, 500);
  }

  return jsonResponse({ success: true });
}

// ============================================================================
// Team Icon Upload
// ============================================================================

/** Max icon file size: 5MB */
const MAX_ICON_SIZE = 5 * 1024 * 1024;

/**
 * POST /api/teams/:id/icon - Upload team icon
 *
 * Accepts multipart/form-data with a file field named "icon".
 * Processes the image at multiple sizes and updates the team.
 */
export async function handleUploadTeamIcon(
  req: Request,
  session: Session | null,
  teamId: number
): Promise<Response> {
  if (!session) {
    return unauthorized();
  }

  const team = getTeam(teamId);
  if (!team) {
    return jsonResponse({ error: "Team not found" }, 404);
  }

  // Check if user is a manager or super-admin
  if (!isAdmin(session.npub) && !isUserTeamManager(team.id, session.npub)) {
    return forbidden("You do not have permission to update this team");
  }

  // Parse the form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse({ error: "Invalid form data" }, 400);
  }

  const file = formData.get("icon");
  if (!file || !(file instanceof File)) {
    return jsonResponse({ error: "No icon file provided" }, 400);
  }

  // Validate file size
  if (file.size > MAX_ICON_SIZE) {
    return jsonResponse({ error: "Icon file too large. Maximum size is 5MB." }, 400);
  }

  // Validate it's an image
  if (!isValidImage(file)) {
    return jsonResponse({ error: "Invalid image file. Supported formats: JPEG, PNG, GIF, WebP." }, 400);
  }

  try {
    // Process the image at icon and standard sizes
    const result = await processImageFromFile(file, {
      sizes: ["icon", "standard"],
      quality: 90,
      format: "webp",
      subDir: `teams/${team.slug}`,
    });

    // Use the standard size as the main icon URL
    const iconUrl = result.images.standard.url;

    // Update the team with the new icon URL
    const updated = updateTeam(teamId, { iconUrl });
    if (!updated) {
      return jsonResponse({ error: "Failed to update team icon" }, 500);
    }

    // Update session if this is the current team
    if (session.currentTeamId === teamId) {
      const membership = session.teamMemberships?.find((m) => m.teamId === teamId);
      if (membership) {
        membership.iconUrl = iconUrl;
      }
    }

    return jsonResponse({
      success: true,
      iconUrl,
      images: {
        icon: result.images.icon.url,
        standard: result.images.standard.url,
      },
    });
  } catch (error) {
    console.error("Failed to process team icon:", error);
    return jsonResponse({ error: "Failed to process image" }, 500);
  }
}
