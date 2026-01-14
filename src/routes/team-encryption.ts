/**
 * Team Encryption Routes
 *
 * Zero-knowledge team key distribution:
 * - Invite codes are used to derive ephemeral keypairs
 * - Team keys are encrypted to invite-derived pubkeys
 * - Server never learns the team encryption key
 *
 * Flow:
 * 1. First invite created: Team key is generated client-side, encrypted to invite-derived pubkey
 * 2. User joins with invite: Client derives key from code, decrypts team key
 * 3. User stores their copy: Team key re-encrypted to user's own pubkey
 */

import { getMasterDb } from "../db-router";
import { jsonResponse, unauthorized } from "../http";
import { getTeamInvitationByCode } from "../master-db";
import { TeamDatabase } from "../team-db";

import type { TeamContext } from "../context";

// ============================================================================
// Team Encryption Status
// ============================================================================

/**
 * GET /t/:slug/api/team/encryption - Get team encryption status
 *
 * Returns:
 * - initialized: boolean - whether team encryption is set up
 * - teamPubkey: string | null - the team's pubkey (if initialized)
 */
export function handleGetTeamEncryption(ctx: TeamContext): Response {
  if (!ctx.session) {
    return unauthorized();
  }

  const db = new TeamDatabase(ctx.teamDb);
  const encryption = db.getTeamEncryption();

  return jsonResponse({
    initialized: encryption !== null,
    teamPubkey: encryption?.team_pubkey ?? null,
  });
}

// ============================================================================
// User Team Key Operations
// ============================================================================

/**
 * GET /t/:slug/api/team/key - Get user's encrypted team key
 *
 * Returns the user's copy of the team key, encrypted to their own pubkey.
 * Returns null if the user hasn't stored their key yet.
 */
export function handleGetUserTeamKey(ctx: TeamContext): Response {
  if (!ctx.session) {
    return unauthorized();
  }

  const db = new TeamDatabase(ctx.teamDb);

  // Get user's pubkey (hex format)
  const userPubkey = ctx.session.pubkey;
  if (!userPubkey) {
    return jsonResponse({ error: "User pubkey not available" }, 400);
  }

  const userKey = db.getUserTeamKey(userPubkey);
  const encryption = db.getTeamEncryption();

  return jsonResponse({
    hasKey: userKey !== null,
    encryptedTeamKey: userKey?.encrypted_team_key ?? null,
    teamPubkey: encryption?.team_pubkey ?? null,
    initialized: encryption !== null,
  });
}

/**
 * POST /t/:slug/api/team/key - Store user's encrypted team key
 *
 * Body: { encryptedTeamKey: string }
 *
 * The client has decrypted the team key (from invite or another user),
 * re-encrypted it to their own pubkey, and is storing it here.
 */
export async function handleStoreUserTeamKey(
  req: Request,
  ctx: TeamContext
): Promise<Response> {
  if (!ctx.session) {
    return unauthorized();
  }

  const userPubkey = ctx.session.pubkey;
  if (!userPubkey) {
    return jsonResponse({ error: "User pubkey not available" }, 400);
  }

  const body = await req.json();
  const { encryptedTeamKey } = body as { encryptedTeamKey?: string };

  if (!encryptedTeamKey) {
    return jsonResponse({ error: "encryptedTeamKey is required" }, 400);
  }

  const db = new TeamDatabase(ctx.teamDb);

  // Verify team encryption is initialized
  if (!db.isTeamEncryptionInitialized()) {
    return jsonResponse({ error: "Team encryption not initialized" }, 400);
  }

  // Store the user's key
  const stored = db.storeUserTeamKey(userPubkey, encryptedTeamKey, userPubkey);
  if (!stored) {
    return jsonResponse({ error: "Failed to store team key" }, 500);
  }

  return jsonResponse({ success: true });
}

// ============================================================================
// Invite Key Exchange
// ============================================================================

/**
 * GET /t/:slug/api/team/invite-key?code=XXX - Get encrypted team key for invite
 *
 * Returns the encrypted team key for an invite code.
 * The client will derive the invite's private key from the code to decrypt it.
 *
 * This endpoint is used during the join flow to retrieve the encrypted key
 * before the invite is fully redeemed.
 */
export function handleGetInviteKey(
  ctx: TeamContext,
  url: URL
): Response {
  if (!ctx.session) {
    return unauthorized();
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return jsonResponse({ error: "code parameter is required" }, 400);
  }

  // Look up the invitation
  const invitation = getTeamInvitationByCode(code);
  if (!invitation) {
    return jsonResponse({ error: "Invalid or expired invite code" }, 404);
  }

  // Verify invitation is for this team
  if (invitation.team_id !== ctx.teamId) {
    return jsonResponse({ error: "Invite code is for a different team" }, 400);
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (invitation.expires_at < now) {
    return jsonResponse({ error: "Invite code has expired" }, 410);
  }

  // Check single-use
  if (invitation.single_use && invitation.redeemed_count > 0) {
    return jsonResponse({ error: "Invite code has already been used" }, 410);
  }

  // Return the encrypted key and creator pubkey
  return jsonResponse({
    encryptedTeamKey: invitation.encrypted_team_key,
    creatorPubkey: invitation.creator_pubkey,
  });
}

// ============================================================================
// Invite Creation with Key
// ============================================================================

/**
 * POST /t/:slug/api/team/init-encryption - Initialize team encryption
 *
 * Body: { teamPubkey: string }
 *
 * Called once when the first invite is created. Sets the team's pubkey
 * which is derived from the first invite code's entropy.
 */
export async function handleInitTeamEncryption(
  req: Request,
  ctx: TeamContext
): Promise<Response> {
  if (!ctx.session) {
    return unauthorized();
  }

  const body = await req.json();
  const { teamPubkey } = body as { teamPubkey?: string };

  if (!teamPubkey) {
    return jsonResponse({ error: "teamPubkey is required" }, 400);
  }

  const db = new TeamDatabase(ctx.teamDb);

  // Check if already initialized
  if (db.isTeamEncryptionInitialized()) {
    // Return existing state
    const existing = db.getTeamEncryption();
    return jsonResponse({
      success: true,
      alreadyInitialized: true,
      teamPubkey: existing?.team_pubkey,
    });
  }

  // Initialize
  const encryption = db.initTeamEncryption(teamPubkey, ctx.session.npub);
  if (!encryption) {
    return jsonResponse({ error: "Failed to initialize team encryption" }, 500);
  }

  // Also store the creator's team key
  const userPubkey = ctx.session.pubkey;
  if (userPubkey) {
    // The creator needs to store their own wrapped key
    // This is handled by a separate call to POST /t/:slug/api/team/key
  }

  return jsonResponse({
    success: true,
    alreadyInitialized: false,
    teamPubkey: encryption.team_pubkey,
  });
}

/**
 * POST /t/:slug/api/team/invite-key - Store encrypted team key for invite
 *
 * Body: { codeHash: string, encryptedTeamKey: string, creatorPubkey: string }
 *
 * Called after creating an invite in the master DB.
 * Stores the NIP-44 encrypted team key for that invite.
 *
 * Note: This updates the existing invite record in the master DB.
 */
export async function handleStoreInviteKey(
  req: Request,
  ctx: TeamContext
): Promise<Response> {
  if (!ctx.session) {
    return unauthorized();
  }

  const body = await req.json();
  const { codeHash, encryptedTeamKey, creatorPubkey } = body as {
    codeHash?: string;
    encryptedTeamKey?: string;
    creatorPubkey?: string;
  };

  if (!codeHash || !encryptedTeamKey || !creatorPubkey) {
    return jsonResponse(
      { error: "codeHash, encryptedTeamKey, and creatorPubkey are required" },
      400
    );
  }

  // We need to update the master DB invitation record
  const masterDb = getMasterDb();

  const updateStmt = masterDb.prepare(`
    UPDATE team_invitations
    SET encrypted_team_key = ?, creator_pubkey = ?
    WHERE code_hash = ? AND team_id = ?
  `);

  const result = updateStmt.run(encryptedTeamKey, creatorPubkey, codeHash, ctx.teamId);

  if (result.changes === 0) {
    return jsonResponse({ error: "Invitation not found" }, 404);
  }

  return jsonResponse({ success: true });
}
