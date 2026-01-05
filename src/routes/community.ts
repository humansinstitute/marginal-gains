/**
 * Community encryption API endpoints
 * Handles community key management, invite codes, and onboarding
 */

import { getWingmanIdentity, isAdmin } from "../config";
import {
  countCommunityKeys,
  countUnencryptedPublicMessages,
  createInviteCode,
  deleteInviteCode,
  getCommunityKey,
  getInviteByHash,
  getUnencryptedPublicMessages,
  isCommunityBootstrapped,
  isMessageMigrationComplete,
  isUserOnboarded,
  listActiveInvites,
  listUsers,
  redeemInvite,
  setCommunityState,
  setUserOnboarded,
  storeCommunityKey,
  storeCommunityKeysBatch,
  updateMessagesToEncryptedBatch,
} from "../db";
import { jsonResponse, unauthorized } from "../http";

import type { Session } from "../types";

function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

// ============================================================
// Community Status
// ============================================================

/**
 * Get community encryption status
 * GET /api/community/status
 */
export function handleCommunityStatus(session: Session | null) {
  if (!session) return unauthorized();

  const bootstrapped = isCommunityBootstrapped();
  const migrationComplete = isMessageMigrationComplete();
  const userOnboarded = isUserOnboarded(session.npub);
  const hasCommunityKey = !!getCommunityKey(session.pubkey);
  const wingmanIdentity = getWingmanIdentity();

  // Admin-only info
  let adminInfo = null;
  if (isAdmin(session.npub)) {
    const users = listUsers();
    const pendingMessages = countUnencryptedPublicMessages();
    const keysDistributed = countCommunityKeys();

    adminInfo = {
      totalUsers: users.length,
      keysDistributed,
      pendingMessages,
      needsBootstrap: !bootstrapped,
      needsMigration: bootstrapped && !migrationComplete && pendingMessages > 0,
      wingmanPubkey: wingmanIdentity?.pubkey ?? null,
    };
  }

  return jsonResponse({
    bootstrapped,
    migrationComplete,
    userOnboarded,
    hasCommunityKey,
    isAdmin: isAdmin(session.npub),
    admin: adminInfo,
    // Wingman npub exposed to all users for UI warnings
    wingmanNpub: wingmanIdentity?.npub ?? null,
  });
}

// ============================================================
// Community Key Management
// ============================================================

/**
 * Get current user's wrapped community key
 * GET /api/community/key
 */
export function handleGetCommunityKey(session: Session | null) {
  if (!session) return unauthorized();

  const key = getCommunityKey(session.pubkey);
  if (!key) {
    return jsonResponse({ error: "No community key found" }, 404);
  }

  return jsonResponse({
    encrypted_key: key.encrypted_key,
    created_at: key.created_at,
  });
}

/**
 * Bootstrap community encryption (admin only)
 * Creates community key and distributes to all existing users
 * POST /api/community/bootstrap
 * Body: { adminKey: string, userKeys: [{ userPubkey: string, wrappedKey: string }] }
 */
export async function handleBootstrapCommunity(req: Request, session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can bootstrap community encryption");

  // Check if already bootstrapped
  if (isCommunityBootstrapped()) {
    return jsonResponse({ error: "Community already bootstrapped" }, 409);
  }

  const body = await req.json();
  const { adminKey, userKeys } = body;

  if (!adminKey || typeof adminKey !== "string") {
    return jsonResponse({ error: "adminKey is required" }, 400);
  }

  // Store admin's wrapped key
  storeCommunityKey(session.pubkey, adminKey);
  setUserOnboarded(session.npub);

  // Store keys for all other users
  if (Array.isArray(userKeys) && userKeys.length > 0) {
    const validKeys = userKeys.filter(
      (k: { userPubkey?: string; wrappedKey?: string }) =>
        k.userPubkey && k.wrappedKey && typeof k.userPubkey === "string" && typeof k.wrappedKey === "string"
    );

    if (validKeys.length > 0) {
      storeCommunityKeysBatch(
        validKeys.map((k: { userPubkey: string; wrappedKey: string }) => ({
          userPubkey: k.userPubkey,
          encryptedKey: k.wrappedKey,
        }))
      );

      // Mark all users as onboarded
      for (const k of validKeys) {
        // Get user by pubkey to mark onboarded
        const users = listUsers();
        const user = users.find((u) => u.pubkey === k.userPubkey);
        if (user) {
          setUserOnboarded(user.npub);
        }
      }
    }
  }

  // Mark community as bootstrapped
  setCommunityState("bootstrapped", "1");

  return jsonResponse({
    success: true,
    keysDistributed: (userKeys?.length ?? 0) + 1,
  });
}

/**
 * Store community key for a user (admin distributing key)
 * POST /api/community/key
 * Body: { userPubkey: string, wrappedKey: string }
 */
export async function handleStoreCommunityKey(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await req.json();
  const { userPubkey, wrappedKey } = body;

  if (!userPubkey || !wrappedKey) {
    return jsonResponse({ error: "userPubkey and wrappedKey are required" }, 400);
  }

  // Users can store their own key, admins can store for anyone
  if (userPubkey !== session.pubkey && !isAdmin(session.npub)) {
    return forbidden("Can only store your own community key");
  }

  const stored = storeCommunityKey(userPubkey, wrappedKey);

  // Mark user as onboarded
  const users = listUsers();
  const user = users.find((u) => u.pubkey === userPubkey);
  if (user) {
    setUserOnboarded(user.npub);
  }

  return jsonResponse(stored, 201);
}

// ============================================================
// Invite Code Management
// ============================================================

/**
 * Create a new invite code (admin only)
 * POST /api/invites
 * Body: { codeHash: string, encryptedKey: string, singleUse: boolean, ttlDays: number }
 */
export async function handleCreateInvite(req: Request, session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can create invite codes");

  if (!isCommunityBootstrapped()) {
    return jsonResponse({ error: "Community must be bootstrapped first" }, 400);
  }

  const body = await req.json();
  const { codeHash, encryptedKey, singleUse, ttlDays } = body;

  if (!codeHash || !encryptedKey) {
    return jsonResponse({ error: "codeHash and encryptedKey are required" }, 400);
  }

  const ttl = Math.min(Math.max(ttlDays || 7, 1), 21); // 1-21 days
  const expiresAt = Math.floor(Date.now() / 1000) + ttl * 24 * 60 * 60;

  const invite = createInviteCode(codeHash, encryptedKey, !!singleUse, session.npub, expiresAt);

  return jsonResponse(invite, 201);
}

/**
 * List active invite codes (admin only)
 * GET /api/invites
 */
export function handleListInvites(session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can view invite codes");

  const invites = listActiveInvites();

  return jsonResponse(
    invites.map((inv) => ({
      id: inv.id,
      singleUse: inv.single_use === 1,
      createdBy: inv.created_by,
      expiresAt: inv.expires_at,
      redeemedCount: inv.redeemed_count,
      createdAt: inv.created_at,
    }))
  );
}

/**
 * Delete an invite code (admin only)
 * DELETE /api/invites/:id
 */
export function handleDeleteInvite(session: Session | null, id: number) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can delete invite codes");

  deleteInviteCode(id);
  return jsonResponse({ success: true });
}

/**
 * Redeem an invite code
 * POST /api/invites/redeem
 * Body: { codeHash: string }
 * Returns: { encryptedKey: string } if valid
 */
export async function handleRedeemInvite(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await req.json();
  const { codeHash } = body;

  if (!codeHash) {
    return jsonResponse({ error: "codeHash is required" }, 400);
  }

  const invite = getInviteByHash(codeHash);
  if (!invite) {
    return jsonResponse({ error: "Invalid invite code" }, 404);
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (invite.expires_at < now) {
    return jsonResponse({ error: "Invite code has expired" }, 410);
  }

  // Check single-use
  if (invite.single_use === 1 && invite.redeemed_count > 0) {
    return jsonResponse({ error: "Invite code has already been used" }, 410);
  }

  // Record redemption
  const redeemed = redeemInvite(invite.id, session.npub);
  if (!redeemed) {
    return jsonResponse({ error: "Failed to redeem invite" }, 500);
  }

  return jsonResponse({
    encrypted_key: invite.encrypted_key,
    invite_id: invite.id,
  });
}

// ============================================================
// Message Migration
// ============================================================

/**
 * Get pending messages for migration (admin only)
 * GET /api/community/migration/pending
 */
export function handleGetPendingMigration(session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can view migration status");

  const count = countUnencryptedPublicMessages();

  return jsonResponse({
    pendingCount: count,
    migrationComplete: isMessageMigrationComplete(),
  });
}

/**
 * Get a batch of unencrypted messages for migration (admin only)
 * GET /api/community/migration/messages?limit=100&after=123
 */
export function handleGetMigrationMessages(session: Session | null, url: URL) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can perform migration");

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const afterId = url.searchParams.get("after");

  const messages = getUnencryptedPublicMessages(limit, afterId ? parseInt(afterId, 10) : undefined);

  return jsonResponse({
    messages: messages.map((m) => ({
      id: m.id,
      channel_id: m.channel_id,
      author: m.author,
      body: m.body,
      created_at: m.created_at,
    })),
    hasMore: messages.length === limit,
  });
}

/**
 * Submit encrypted messages for migration (admin only)
 * POST /api/community/migration/batch
 * Body: { messages: [{ id: number, body: string }] }
 */
export async function handleMigrationBatch(req: Request, session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can perform migration");

  const body = await req.json();
  const { messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: "messages array is required" }, 400);
  }

  // Validate and prepare batch
  const validMessages = messages
    .filter(
      (m: { id?: number; body?: string }) =>
        typeof m.id === "number" && typeof m.body === "string"
    )
    .map((m: { id: number; body: string }) => ({
      id: m.id,
      body: m.body,
      keyVersion: 1, // Community key is always version 1
    }));

  if (validMessages.length === 0) {
    return jsonResponse({ error: "No valid messages provided" }, 400);
  }

  updateMessagesToEncryptedBatch(validMessages);

  // Check if migration is complete
  const remaining = countUnencryptedPublicMessages();
  if (remaining === 0) {
    setCommunityState("message_migration_complete", "1");
  }

  return jsonResponse({
    updated: validMessages.length,
    remaining,
    complete: remaining === 0,
  });
}

/**
 * Mark migration as complete (admin only)
 * POST /api/community/migration/complete
 */
export function handleCompleteMigration(session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) return forbidden("Only admins can complete migration");

  setCommunityState("message_migration_complete", "1");
  return jsonResponse({ success: true });
}
