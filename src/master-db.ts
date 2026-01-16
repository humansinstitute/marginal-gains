/**
 * Master Database Operations
 *
 * All operations for the master database:
 * - Team CRUD
 * - Team memberships
 * - Team invitations
 * - Global user directory
 */

import { createHash, randomBytes } from "crypto";
import { unlinkSync } from "fs";

import { getMasterDb, getTeamDbPath, getTeamDb } from "./db-router";

import type {
  Team,
  TeamMembership,
  TeamMembershipWithTeam,
  GlobalUser,
  TeamInvitation,
} from "./db-router";
import type { SessionTeamMembership } from "./types";

// ============================================================================
// Team CRUD Operations
// ============================================================================

/**
 * Create a new team
 */
export function createTeam(
  slug: string,
  displayName: string,
  description: string,
  createdBy: string,
  iconUrl?: string
): Team {
  const db = getMasterDb();
  const stmt = db.prepare(`
    INSERT INTO teams (slug, display_name, description, created_by, icon_url)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(slug.toLowerCase(), displayName, description, createdBy, iconUrl ?? null);

  const team = getTeamBySlug(slug);
  if (!team) throw new Error("Failed to create team");

  // Initialize the team database by opening it (triggers schema creation)
  getTeamDb(slug);

  return team;
}

/**
 * Get a team by ID
 */
export function getTeam(id: number): Team | null {
  const db = getMasterDb();
  const stmt = db.prepare<Team, [number]>("SELECT * FROM teams WHERE id = ?");
  return stmt.get(id) ?? null;
}

/**
 * Get a team by slug
 */
export function getTeamBySlug(slug: string): Team | null {
  const db = getMasterDb();
  const stmt = db.prepare<Team, [string]>("SELECT * FROM teams WHERE slug = ?");
  return stmt.get(slug.toLowerCase()) ?? null;
}

/**
 * List all active teams
 */
export function listTeams(): Team[] {
  const db = getMasterDb();
  const stmt = db.prepare<Team, []>(
    "SELECT * FROM teams WHERE is_active = 1 ORDER BY display_name"
  );
  return stmt.all();
}

/**
 * Update a team
 */
export function updateTeam(
  id: number,
  updates: { displayName?: string; description?: string; iconUrl?: string }
): Team | null {
  const db = getMasterDb();
  const team = getTeam(id);
  if (!team) return null;

  const displayName = updates.displayName ?? team.display_name;
  const description = updates.description ?? team.description;
  const iconUrl = updates.iconUrl ?? team.icon_url;

  const stmt = db.prepare(`
    UPDATE teams SET display_name = ?, description = ?, icon_url = ?
    WHERE id = ?
  `);
  stmt.run(displayName, description, iconUrl, id);

  return getTeam(id);
}

/**
 * Soft-delete a team (sets is_active = 0)
 */
export function deactivateTeam(id: number): boolean {
  const db = getMasterDb();
  const stmt = db.prepare("UPDATE teams SET is_active = 0 WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Permanently delete a team
 * WARNING: This deletes all team data including the team database file
 */
export function deleteTeam(id: number): boolean {
  const team = getTeam(id);
  if (!team) return false;

  const db = getMasterDb();

  // Delete from master DB (cascades to memberships and invitations)
  const stmt = db.prepare("DELETE FROM teams WHERE id = ?");
  const result = stmt.run(id);

  if (result.changes > 0) {
    // Delete the team database file
    const dbPath = getTeamDbPath(team.slug);
    try {
      unlinkSync(dbPath);
    } catch {
      // File may not exist, that's ok
    }
  }

  return result.changes > 0;
}

/**
 * Check if a team slug is available
 */
export function isTeamSlugAvailable(slug: string): boolean {
  return getTeamBySlug(slug) === null;
}

// ============================================================================
// Team Membership Operations
// ============================================================================

/**
 * Add a member to a team
 */
export function addTeamMember(
  teamId: number,
  userNpub: string,
  role: "owner" | "manager" | "member" = "member",
  invitedBy?: string
): TeamMembership | null {
  console.log("[Teams] Adding team member with role:", role, "for user:", userNpub.slice(0, 15));
  const db = getMasterDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO team_memberships (team_id, user_npub, role, invited_by)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(teamId, userNpub, role, invitedBy ?? null);

  return getTeamMembership(teamId, userNpub);
}

/**
 * Remove a member from a team
 */
export function removeTeamMember(teamId: number, userNpub: string): boolean {
  const db = getMasterDb();
  const stmt = db.prepare("DELETE FROM team_memberships WHERE team_id = ? AND user_npub = ?");
  const result = stmt.run(teamId, userNpub);
  return result.changes > 0;
}

/**
 * Get a specific team membership
 */
export function getTeamMembership(teamId: number, userNpub: string): TeamMembership | null {
  const db = getMasterDb();
  const stmt = db.prepare<TeamMembership, [number, string]>(
    "SELECT * FROM team_memberships WHERE team_id = ? AND user_npub = ?"
  );
  return stmt.get(teamId, userNpub) ?? null;
}

/**
 * Update a member's role
 */
export function updateTeamMemberRole(
  teamId: number,
  userNpub: string,
  role: "owner" | "manager" | "member"
): boolean {
  const db = getMasterDb();
  const stmt = db.prepare("UPDATE team_memberships SET role = ? WHERE team_id = ? AND user_npub = ?");
  const result = stmt.run(role, teamId, userNpub);
  return result.changes > 0;
}

/**
 * List all members of a team
 */
export function getTeamMembers(teamId: number): TeamMembership[] {
  const db = getMasterDb();
  const stmt = db.prepare<TeamMembership, [number]>(
    "SELECT * FROM team_memberships WHERE team_id = ? ORDER BY role, joined_at"
  );
  return stmt.all(teamId);
}

/**
 * Get all teams a user belongs to (for session)
 */
export function getUserTeams(userNpub: string): SessionTeamMembership[] {
  const db = getMasterDb();
  const stmt = db.prepare<TeamMembershipWithTeam, [string]>(`
    SELECT
      tm.*,
      t.slug as team_slug,
      t.display_name as team_display_name,
      t.icon_url as team_icon_url
    FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_npub = ? AND t.is_active = 1
    ORDER BY t.display_name
  `);
  const rows = stmt.all(userNpub);

  return rows.map((row) => ({
    teamId: row.team_id,
    teamSlug: row.team_slug,
    displayName: row.team_display_name,
    role: row.role as "owner" | "manager" | "member",
  }));
}

/**
 * Check if a user is a member of a team
 */
export function isUserTeamMember(teamId: number, userNpub: string): boolean {
  return getTeamMembership(teamId, userNpub) !== null;
}

/**
 * Check if a user is a team owner
 */
export function isUserTeamOwner(teamId: number, userNpub: string): boolean {
  const membership = getTeamMembership(teamId, userNpub);
  return membership?.role === "owner";
}

/**
 * Check if a user is a team manager (owner or manager role)
 */
export function isUserTeamManager(teamId: number, userNpub: string): boolean {
  const membership = getTeamMembership(teamId, userNpub);
  return membership?.role === "owner" || membership?.role === "manager";
}

/**
 * Count members in a team
 */
export function getTeamMemberCount(teamId: number): number {
  const db = getMasterDb();
  const stmt = db.prepare<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM team_memberships WHERE team_id = ?"
  );
  const result = stmt.get(teamId);
  return result?.count ?? 0;
}

// ============================================================================
// Team Invitation Operations
// ============================================================================

/**
 * Create a team invitation code
 */
export function createTeamInvitation(
  teamId: number,
  createdBy: string,
  role: "owner" | "manager" | "member" = "member",
  singleUse = true,
  expiresInHours = 168, // 7 days
  label: string | null = null
): { code: string; invitation: TeamInvitation } {
  const db = getMasterDb();

  // Generate a random code
  const code = randomBytes(16).toString("base64url");
  const codeHash = createHash("sha256").update(code).digest("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInHours * 3600;

  console.log("[Teams] Creating invitation with role:", role, "label:", label);
  const stmt = db.prepare(`
    INSERT INTO team_invitations (team_id, code_hash, role, single_use, expires_at, created_by, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(teamId, codeHash, role, singleUse ? 1 : 0, expiresAt, createdBy, label);

  const invitation = getTeamInvitationByHash(codeHash);
  if (!invitation) throw new Error("Failed to create invitation");

  return { code, invitation };
}

/**
 * Get an invitation by code hash
 */
export function getTeamInvitationByHash(codeHash: string): TeamInvitation | null {
  const db = getMasterDb();
  const stmt = db.prepare<TeamInvitation, [string]>(
    "SELECT * FROM team_invitations WHERE code_hash = ?"
  );
  return stmt.get(codeHash) ?? null;
}

/**
 * Get an invitation by raw code
 */
export function getTeamInvitationByCode(code: string): TeamInvitation | null {
  const codeHash = createHash("sha256").update(code).digest("hex");
  return getTeamInvitationByHash(codeHash);
}

/**
 * Redeem a team invitation
 */
export function redeemTeamInvitation(
  code: string,
  userNpub: string
): { success: boolean; error?: string; team?: Team } {
  const invitation = getTeamInvitationByCode(code);
  if (!invitation) {
    return { success: false, error: "Invalid invitation code" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (invitation.expires_at < now) {
    return { success: false, error: "Invitation has expired" };
  }

  if (invitation.single_use && invitation.redeemed_count > 0) {
    return { success: false, error: "Invitation has already been used" };
  }

  const team = getTeam(invitation.team_id);
  if (!team || !team.is_active) {
    return { success: false, error: "Team no longer exists" };
  }

  // Check if user is already a member
  if (isUserTeamMember(invitation.team_id, userNpub)) {
    return { success: false, error: "You are already a member of this team" };
  }

  const db = getMasterDb();

  // Add the user as a member
  console.log("[Teams] Redeeming invitation with role:", invitation.role);
  addTeamMember(
    invitation.team_id,
    userNpub,
    invitation.role as "owner" | "manager" | "member",
    invitation.created_by
  );

  // Increment redeemed count
  const updateStmt = db.prepare(
    "UPDATE team_invitations SET redeemed_count = redeemed_count + 1 WHERE id = ?"
  );
  updateStmt.run(invitation.id);

  return { success: true, team };
}

/**
 * List active invitations for a team
 */
export function getTeamInvitations(teamId: number): TeamInvitation[] {
  const db = getMasterDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare<TeamInvitation, [number, number]>(
    "SELECT * FROM team_invitations WHERE team_id = ? AND expires_at > ? ORDER BY created_at DESC"
  );
  return stmt.all(teamId, now);
}

/**
 * Delete an invitation
 */
export function deleteTeamInvitation(id: number): boolean {
  const db = getMasterDb();
  const stmt = db.prepare("DELETE FROM team_invitations WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Clean up expired invitations
 */
export function cleanupExpiredInvitations(): number {
  const db = getMasterDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare("DELETE FROM team_invitations WHERE expires_at < ?");
  const result = stmt.run(now);
  return result.changes;
}

// ============================================================================
// Invite Group Operations
// ============================================================================

/**
 * Add groups to an invitation
 * When redeemed, user will be added to these groups (giving channel access)
 */
export function addInviteGroups(
  invitationId: number,
  groupIds: number[]
): void {
  const db = getMasterDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO invite_groups (invitation_id, group_id)
    VALUES (?, ?)
  `);

  for (const groupId of groupIds) {
    stmt.run(invitationId, groupId);
  }
}

/**
 * Get groups associated with an invitation
 */
export function getInviteGroups(invitationId: number): Array<{
  id: number;
  invitation_id: number;
  group_id: number;
  created_at: number;
}> {
  const db = getMasterDb();
  const stmt = db.prepare<
    { id: number; invitation_id: number; group_id: number; created_at: number },
    [number]
  >("SELECT * FROM invite_groups WHERE invitation_id = ?");
  return stmt.all(invitationId);
}

/**
 * Get groups associated with an invitation by code
 */
export function getInviteGroupsByCode(code: string): Array<{
  id: number;
  invitation_id: number;
  group_id: number;
  created_at: number;
}> {
  const invitation = getTeamInvitationByCode(code);
  if (!invitation) return [];
  return getInviteGroups(invitation.id);
}

/**
 * Delete all groups from an invitation
 */
export function deleteInviteGroups(invitationId: number): number {
  const db = getMasterDb();
  const stmt = db.prepare("DELETE FROM invite_groups WHERE invitation_id = ?");
  const result = stmt.run(invitationId);
  return result.changes;
}

// ============================================================================
// Global User Directory
// ============================================================================

/**
 * Upsert a user in the global directory
 */
export function upsertGlobalUser(
  npub: string,
  pubkey: string,
  displayName?: string,
  picture?: string
): GlobalUser {
  const db = getMasterDb();
  const stmt = db.prepare(`
    INSERT INTO users_global (npub, pubkey, display_name, picture)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(npub) DO UPDATE SET
      pubkey = excluded.pubkey,
      display_name = COALESCE(excluded.display_name, display_name),
      picture = COALESCE(excluded.picture, picture)
  `);
  stmt.run(npub, pubkey, displayName ?? null, picture ?? null);

  return getGlobalUser(npub)!;
}

/**
 * Get a user from the global directory
 */
export function getGlobalUser(npub: string): GlobalUser | null {
  const db = getMasterDb();
  const stmt = db.prepare<GlobalUser, [string]>("SELECT * FROM users_global WHERE npub = ?");
  return stmt.get(npub) ?? null;
}

/**
 * Search global users by display name (for admin tools)
 */
export function searchGlobalUsers(query: string, limit = 20): GlobalUser[] {
  const db = getMasterDb();
  const stmt = db.prepare<GlobalUser, [string, number]>(`
    SELECT * FROM users_global
    WHERE display_name LIKE ? OR npub LIKE ?
    ORDER BY display_name
    LIMIT ?
  `);
  const pattern = `%${query}%`;
  return stmt.all(pattern, limit);
}

// ============================================================================
// Team Managers (special group for team creation permission)
// ============================================================================

const TEAM_MANAGERS_TEAM_SLUG = "__system__";

/**
 * Check if a user can create teams
 * Users can create teams if they are:
 * - A super-admin (checked separately via ADMIN_NPUBS)
 * - A member of the special "__system__" team with manager role
 */
export function canUserCreateTeams(userNpub: string): boolean {
  const systemTeam = getTeamBySlug(TEAM_MANAGERS_TEAM_SLUG);
  if (!systemTeam) return false;
  return isUserTeamManager(systemTeam.id, userNpub);
}

/**
 * Initialize the system team for team managers
 * Called during migration/setup
 */
export function initializeSystemTeam(createdBy: string): Team {
  let team = getTeamBySlug(TEAM_MANAGERS_TEAM_SLUG);
  if (team) return team;

  const db = getMasterDb();
  const stmt = db.prepare(`
    INSERT INTO teams (slug, display_name, description, created_by, is_active)
    VALUES (?, ?, ?, ?, 1)
  `);
  stmt.run(
    TEAM_MANAGERS_TEAM_SLUG,
    "System",
    "System team for managing team creation permissions",
    createdBy
  );

  team = getTeamBySlug(TEAM_MANAGERS_TEAM_SLUG);
  if (!team) throw new Error("Failed to create system team");

  return team;
}

/**
 * Add a user to team managers (allows them to create teams)
 */
export function addTeamManager(userNpub: string, addedBy: string): boolean {
  const systemTeam = getTeamBySlug(TEAM_MANAGERS_TEAM_SLUG);
  if (!systemTeam) {
    initializeSystemTeam(addedBy);
    return addTeamManager(userNpub, addedBy);
  }

  const membership = addTeamMember(systemTeam.id, userNpub, "manager", addedBy);
  return membership !== null;
}

/**
 * Remove a user from team managers
 */
export function removeTeamManager(userNpub: string): boolean {
  const systemTeam = getTeamBySlug(TEAM_MANAGERS_TEAM_SLUG);
  if (!systemTeam) return false;
  return removeTeamMember(systemTeam.id, userNpub);
}

/**
 * List all team managers
 */
export function listTeamManagers(): TeamMembership[] {
  const systemTeam = getTeamBySlug(TEAM_MANAGERS_TEAM_SLUG);
  if (!systemTeam) return [];
  return getTeamMembers(systemTeam.id);
}
