/**
 * Community encryption module for Marginal Gains
 * Handles community key management, invite codes, and onboarding
 */

import {
  generateChannelKey,
  wrapKeyForUser,
  unwrapKey,
  encryptMessage,
  decryptMessage,
  encryptAuthenticatedMessage,
  decryptAuthenticatedMessage,
} from "./crypto.js";
import { loadNostrLibs, bytesToHex } from "./nostr.js";
import { EPHEMERAL_SECRET_KEY } from "./constants.js";

// Key cache in sessionStorage
const COMMUNITY_KEY_CACHE = "mg_community_key";

// ============================================================
// HKDF Key Derivation for Invite Codes
// ============================================================

/**
 * Hash an invite code with SHA256 for server lookup
 * @param {string} code - The plaintext invite code
 * @returns {Promise<string>} Base64-encoded SHA256 hash
 */
export async function hashInviteCode(code) {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

/**
 * Derive an AES-256-GCM key from an invite code using HKDF
 * @param {string} code - The plaintext invite code
 * @returns {Promise<CryptoKey>} Derived encryption key
 */
export async function deriveKeyFromCode(code) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(code),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("mg-invite-v1"),
      info: new Uint8Array(),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Export a CryptoKey to base64
 * @param {CryptoKey} key
 * @returns {Promise<string>} Base64-encoded key
 */
async function exportKey(key) {
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(rawKey)));
}

/**
 * Import a base64-encoded key
 * @param {string} keyBase64
 * @returns {Promise<CryptoKey>}
 */
async function importKey(keyBase64) {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ============================================================
// Community Key Cache
// ============================================================

/**
 * Get cached community key from sessionStorage
 * @returns {string|null} Base64-encoded community key
 */
export function getCachedCommunityKey() {
  try {
    const cached = sessionStorage.getItem(COMMUNITY_KEY_CACHE);
    if (cached) {
      const { key, expiry } = JSON.parse(cached);
      if (Date.now() < expiry) {
        return key;
      }
      sessionStorage.removeItem(COMMUNITY_KEY_CACHE);
    }
  } catch (_err) {
    // Ignore cache errors
  }
  return null;
}

/**
 * Cache community key in sessionStorage
 * @param {string} keyBase64
 */
export function cacheCommunityKey(keyBase64) {
  try {
    const data = {
      key: keyBase64,
      expiry: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };
    sessionStorage.setItem(COMMUNITY_KEY_CACHE, JSON.stringify(data));
  } catch (_err) {
    // Ignore cache errors
  }
}

/**
 * Clear cached community key
 */
export function clearCommunityKeyCache() {
  sessionStorage.removeItem(COMMUNITY_KEY_CACHE);
}

// ============================================================
// Community Status
// ============================================================

/**
 * Fetch community encryption status from server
 * @returns {Promise<{bootstrapped: boolean, userOnboarded: boolean, hasCommunityKey: boolean, isAdmin: boolean, admin?: object}>}
 */
export async function getCommunityStatus() {
  try {
    const res = await fetch("/api/community/status", {
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.warn("[CommunityCrypto] Failed to get status:", res.status);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("[CommunityCrypto] Error fetching status:", err);
    return null;
  }
}

// ============================================================
// Community Key Management
// ============================================================

/**
 * Fetch and unwrap the community key for the current user
 * @returns {Promise<string|null>} Base64-encoded community key
 */
export async function fetchCommunityKey() {
  // Check cache first
  const cached = getCachedCommunityKey();
  if (cached) return cached;

  try {
    const res = await fetch("/api/community/key", {
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.warn("[CommunityCrypto] No community key found, status:", res.status);
      return null;
    }
    const data = await res.json();
    const wrappedKey = data.encrypted_key;

    // Unwrap the key using NIP-44
    const communityKey = await unwrapKey(wrappedKey);

    // Cache for future use
    cacheCommunityKey(communityKey);

    return communityKey;
  } catch (err) {
    console.error("[CommunityCrypto] Failed to fetch/unwrap community key:", err);
    return null;
  }
}

/**
 * Get the current user's ephemeral secret key or null
 * Checks sessionStorage first (key teleport), then localStorage
 * @returns {Uint8Array|null}
 */
function getEphemeralSecretKey() {
  const stored = sessionStorage.getItem(EPHEMERAL_SECRET_KEY) || localStorage.getItem(EPHEMERAL_SECRET_KEY);
  if (!stored) return null;

  // Validate hex format (should be exactly 64 chars for 32 bytes)
  if (stored.length !== 64) {
    console.error("[CommunityCrypto] Invalid stored secret key length:", stored.length, "expected 64");
    return null;
  }

  // Convert hex string to Uint8Array
  const bytes = Uint8Array.from(stored.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  console.log("[CommunityCrypto] getEphemeralSecretKey - bytes length:", bytes.length);
  return bytes;
}

/**
 * Get current user's public key (hex)
 * Checks sessionStorage first (key teleport), then localStorage
 * @returns {Promise<string>}
 */
async function getCurrentPubkey() {
  // Try browser extension first
  if (window.nostr?.getPublicKey) {
    const pubkey = await window.nostr.getPublicKey();
    console.log("[CommunityCrypto] getCurrentPubkey from extension:", pubkey?.length, pubkey);
    return pubkey;
  }

  // Try ephemeral key - sessionStorage first (key teleport), then localStorage
  const stored = sessionStorage.getItem(EPHEMERAL_SECRET_KEY) || localStorage.getItem(EPHEMERAL_SECRET_KEY);
  if (stored) {
    console.log("[CommunityCrypto] getCurrentPubkey - stored hex length:", stored.length);

    if (stored.length !== 64) {
      throw new Error(`Invalid stored secret key length: ${stored.length}, expected 64`);
    }

    const { pure } = await loadNostrLibs();
    const secretKey = Uint8Array.from(stored.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    // pure.getPublicKey already returns a hex string, don't double-encode!
    const pubkey = pure.getPublicKey(secretKey);
    console.log("[CommunityCrypto] getCurrentPubkey derived:", pubkey?.length, pubkey);
    return pubkey;
  }

  throw new Error("No signing key available");
}

// ============================================================
// Admin Functions
// ============================================================

/**
 * Bootstrap the community encryption (admin only)
 * Generates a community key and wraps it for all existing users
 * @param {Array<{pubkey: string, npub: string}>} users - All existing users
 * @param {string|null} wingmanPubkey - Wingman's pubkey (optional)
 * @returns {Promise<{success: boolean, keysDistributed: number, error?: string}>}
 */
export async function bootstrapCommunityEncryption(users = [], wingmanPubkey = null) {
  try {
    // Generate new community key
    const communityKey = await generateChannelKey();

    // Get admin's pubkey
    const adminPubkey = await getCurrentPubkey();

    // Wrap key for admin
    const adminWrappedKey = await wrapKeyForUser(communityKey, adminPubkey);

    // Wrap key for all other users
    const userKeys = [];
    for (const user of users) {
      if (user.pubkey !== adminPubkey) {
        try {
          const wrappedKey = await wrapKeyForUser(communityKey, user.pubkey);
          userKeys.push({
            userPubkey: user.pubkey,
            wrappedKey,
          });
        } catch (err) {
          console.error(`[CommunityCrypto] Failed to wrap key for ${user.npub}:`, err);
        }
      }
    }

    // Include Wingman in key distribution if configured
    if (wingmanPubkey && wingmanPubkey !== adminPubkey) {
      try {
        const wingmanWrappedKey = await wrapKeyForUser(communityKey, wingmanPubkey);
        userKeys.push({
          userPubkey: wingmanPubkey,
          wrappedKey: wingmanWrappedKey,
        });
        console.log("[CommunityCrypto] Included Wingman in community key distribution");
      } catch (err) {
        console.error("[CommunityCrypto] Failed to wrap key for Wingman:", err);
      }
    }

    // Send to server
    const res = await fetch("/api/community/bootstrap", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminKey: adminWrappedKey,
        userKeys,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      return { success: false, keysDistributed: 0, error: data.error || "Bootstrap failed" };
    }

    // Cache the community key
    cacheCommunityKey(communityKey);

    const data = await res.json();
    return { success: true, keysDistributed: data.keysDistributed };
  } catch (err) {
    console.error("[CommunityCrypto] Bootstrap failed:", err);
    return { success: false, keysDistributed: 0, error: err.message };
  }
}

/**
 * Generate a random invite code
 * @returns {string} Format: XXXX-XXXX-XXXX
 */
export function generateInviteCodeString() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I, O, 0, 1 for clarity
  let code = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Create a new invite code (admin only)
 * @param {object} options
 * @param {boolean} options.singleUse - Single-use or multi-use
 * @param {number} options.ttlDays - Days until expiry (1-21)
 * @returns {Promise<{success: boolean, code?: string, error?: string}>}
 */
export async function createInviteCode({ singleUse = false, ttlDays = 7 } = {}) {
  try {
    // Get community key first
    const communityKey = await fetchCommunityKey();
    if (!communityKey) {
      return { success: false, error: "Community not bootstrapped or no access to community key" };
    }

    // Generate random invite code
    const code = generateInviteCodeString();

    // Hash for server lookup
    const codeHash = await hashInviteCode(code);

    // Derive key from code
    const derivedKey = await deriveKeyFromCode(code);
    const derivedKeyBase64 = await exportKey(derivedKey);

    // Encrypt community key with derived key
    const encryptedKey = await encryptMessage(communityKey, derivedKeyBase64);

    // Send to server
    const res = await fetch("/api/invites", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codeHash,
        encryptedKey,
        singleUse,
        ttlDays,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      return { success: false, error: data.error || "Failed to create invite" };
    }

    return { success: true, code };
  } catch (err) {
    console.error("[CommunityCrypto] Failed to create invite:", err);
    return { success: false, error: err.message };
  }
}

/**
 * List active invite codes (admin only)
 * @returns {Promise<Array>}
 */
export async function listInviteCodes() {
  try {
    const res = await fetch("/api/invites", {
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.warn("[CommunityCrypto] Failed to list invites:", res.status);
      return [];
    }
    return res.json();
  } catch (err) {
    console.error("[CommunityCrypto] Error listing invites:", err);
    return [];
  }
}

/**
 * Delete an invite code (admin only)
 * @param {number} id - Invite code ID
 * @returns {Promise<boolean>}
 */
export async function deleteInviteCode(id) {
  try {
    const res = await fetch(`/api/invites/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return res.ok;
  } catch (err) {
    console.error("[CommunityCrypto] Error deleting invite:", err);
    return false;
  }
}

// ============================================================
// Invite Redemption (New User Onboarding)
// ============================================================

/**
 * Safely parse JSON from a response, returning null on failure
 * @param {Response} res
 * @returns {Promise<object|null>}
 */
async function safeParseJson(res) {
  try {
    const text = await res.text();
    if (!text || text.trim().length === 0) {
      console.warn("[CommunityCrypto] Empty response body");
      return null;
    }
    return JSON.parse(text);
  } catch (err) {
    console.error("[CommunityCrypto] Failed to parse JSON:", err);
    return null;
  }
}

/**
 * Redeem an invite code to get the community key
 * @param {string} code - The plaintext invite code
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function redeemInviteCode(code) {
  try {
    // Hash the code for server lookup
    const codeHash = await hashInviteCode(code);
    console.log("[CommunityCrypto] Redeeming invite, hash:", codeHash.slice(0, 10) + "...");

    // Send hash to server
    const res = await fetch("/api/invites/redeem", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeHash }),
    });

    console.log("[CommunityCrypto] Redeem response status:", res.status);

    if (!res.ok) {
      const data = await safeParseJson(res);
      const errorMsg = data?.error || `Server error: ${res.status}`;
      return { success: false, error: errorMsg };
    }

    const data = await safeParseJson(res);
    if (!data || !data.encrypted_key) {
      return { success: false, error: "Invalid server response - no encrypted key" };
    }

    const encryptedKey = data.encrypted_key;
    console.log("[CommunityCrypto] Got encrypted key, length:", encryptedKey.length);

    // Derive key from code
    const derivedKey = await deriveKeyFromCode(code);
    const derivedKeyBase64 = await exportKey(derivedKey);
    console.log("[CommunityCrypto] Derived key from code");

    // Decrypt community key
    const communityKey = await decryptMessage(encryptedKey, derivedKeyBase64);
    console.log("[CommunityCrypto] Decrypted community key, length:", communityKey.length);

    // Wrap to user's pubkey and store
    const userPubkey = await getCurrentPubkey();
    console.log("[CommunityCrypto] User pubkey:", userPubkey.slice(0, 10) + "...");

    const wrappedKey = await wrapKeyForUser(communityKey, userPubkey);
    console.log("[CommunityCrypto] Wrapped key for user, length:", wrappedKey.length);

    // Store wrapped key for this user
    const storeRes = await fetch("/api/community/key", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPubkey,
        wrappedKey,
      }),
    });

    console.log("[CommunityCrypto] Store response status:", storeRes.status);

    if (!storeRes.ok) {
      const storeData = await safeParseJson(storeRes);
      const errorMsg = storeData?.error || `Failed to store key: ${storeRes.status}`;
      return { success: false, error: errorMsg };
    }

    // Cache the community key
    cacheCommunityKey(communityKey);
    console.log("[CommunityCrypto] Invite redeemed successfully");

    return { success: true };
  } catch (err) {
    console.error("[CommunityCrypto] Failed to redeem invite:", err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// Community Message Encryption
// ============================================================

/**
 * Encrypt a message with the community key
 * @param {string} content - Plaintext message
 * @returns {Promise<{encrypted: string, keyVersion: number}|null>}
 */
export async function encryptMessageForCommunity(content) {
  try {
    const communityKey = await fetchCommunityKey();
    if (!communityKey) {
      console.error("[CommunityCrypto] No community key available for encryption");
      return null;
    }

    const encrypted = await encryptAuthenticatedMessage(content, communityKey);
    return { encrypted, keyVersion: 1 };
  } catch (err) {
    console.error("[CommunityCrypto] Failed to encrypt message:", err);
    return null;
  }
}

/**
 * Decrypt a message encrypted with the community key
 * @param {string} ciphertext - Base64-encoded ciphertext
 * @returns {Promise<{content: string, sender: string, valid: boolean}|null>}
 */
export async function decryptMessageFromCommunity(ciphertext) {
  try {
    const communityKey = await fetchCommunityKey();
    if (!communityKey) {
      console.error("[CommunityCrypto] No community key available for decryption");
      return null;
    }

    const result = await decryptAuthenticatedMessage(ciphertext, communityKey);
    return result;
  } catch (err) {
    console.error("[CommunityCrypto] Failed to decrypt message:", err);
    return null;
  }
}

// ============================================================
// Migration Support
// ============================================================

/**
 * Get pending messages for migration (admin only)
 * @returns {Promise<{pendingCount: number, migrationComplete: boolean}|null>}
 */
export async function getMigrationStatus() {
  try {
    const res = await fetch("/api/community/migration/pending", {
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("[CommunityCrypto] Error getting migration status:", err);
    return null;
  }
}

/**
 * Get a batch of unencrypted messages for migration
 * @param {number} limit - Max messages to fetch
 * @param {number} afterId - Fetch messages after this ID
 * @returns {Promise<{messages: Array, hasMore: boolean}|null>}
 */
export async function getMigrationMessages(limit = 100, afterId = null) {
  try {
    let url = `/api/community/migration/messages?limit=${limit}`;
    if (afterId) url += `&after=${afterId}`;

    const res = await fetch(url, {
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("[CommunityCrypto] Error getting migration messages:", err);
    return null;
  }
}

/**
 * Encrypt and submit a batch of messages for migration
 * @param {Array<{id: number, body: string}>} messages - Messages to encrypt
 * @returns {Promise<{updated: number, remaining: number, complete: boolean}|null>}
 */
export async function submitMigrationBatch(messages) {
  try {
    const communityKey = await fetchCommunityKey();
    if (!communityKey) {
      console.error("[CommunityCrypto] No community key for migration");
      return null;
    }

    // Encrypt each message
    const encrypted = await Promise.all(
      messages.map(async (m) => {
        const encryptedBody = await encryptAuthenticatedMessage(m.body, communityKey);
        return {
          id: m.id,
          body: encryptedBody,
        };
      })
    );

    const res = await fetch("/api/community/migration/batch", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: encrypted }),
    });

    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.error("[CommunityCrypto] Error submitting migration batch:", err);
    return null;
  }
}

/**
 * Mark migration as complete (admin only)
 * @returns {Promise<boolean>}
 */
export async function completeMigration() {
  try {
    const res = await fetch("/api/community/migration/complete", {
      method: "POST",
      credentials: "same-origin",
    });
    return res.ok;
  } catch (err) {
    console.error("[CommunityCrypto] Error completing migration:", err);
    return false;
  }
}
