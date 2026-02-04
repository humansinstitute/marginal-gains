/**
 * Team Encryption Module for Marginal Gains
 *
 * Zero-knowledge team key distribution:
 * - Invite codes are used to derive ephemeral Nostr keypairs
 * - Team keys are encrypted to invite-derived pubkeys using NIP-44
 * - Server never learns the team encryption key
 *
 * Flow:
 * 1. First invite: Generate team key, encrypt to invite-derived pubkey
 * 2. User joins: Derive key from invite code, decrypt team key
 * 3. User stores: Re-encrypt team key to own pubkey and store
 */

import { loadNostrLibs, bytesToHex, hexToBytes } from "./nostr.js";
import { wrapKeyForUser, unwrapKey, generateChannelKey } from "./crypto.js";
import { state } from "./state.js";
import { EPHEMERAL_SECRET_KEY } from "./constants.js";

// Key cache in sessionStorage
const TEAM_KEY_CACHE_PREFIX = "mg_team_key_";

// ============================================================
// Invite Code Key Derivation
// ============================================================

/**
 * Hash an invite code with SHA256 for server lookup
 * @param {string} code - The plaintext invite code
 * @returns {Promise<string>} Hex-encoded SHA256 hash
 */
export async function hashInviteCode(code) {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Derive a Nostr secret key (32 bytes) from an invite code
 * Uses SHA256(invite code) as the private key
 * @param {string} code - The plaintext invite code
 * @returns {Promise<Uint8Array>} 32-byte secret key
 */
export async function deriveSecretKeyFromCode(code) {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

/**
 * Derive a Nostr public key from an invite code
 * @param {string} code - The plaintext invite code
 * @returns {Promise<string>} Hex-encoded public key
 */
export async function derivePublicKeyFromCode(code) {
  const { pure } = await loadNostrLibs();
  const secretKey = await deriveSecretKeyFromCode(code);
  return pure.getPublicKey(secretKey);
}

// ============================================================
// Team Key Cache
// ============================================================

/**
 * Get team key cache key for a specific team
 * @param {string} teamSlug
 * @returns {string}
 */
function getTeamCacheKey(teamSlug) {
  return `${TEAM_KEY_CACHE_PREFIX}${teamSlug}`;
}

/**
 * Get cached team key from sessionStorage
 * @param {string} teamSlug
 * @returns {string|null} Base64-encoded team key
 */
export function getCachedTeamKey(teamSlug) {
  try {
    const cached = sessionStorage.getItem(getTeamCacheKey(teamSlug));
    if (cached) {
      const { key, expiry } = JSON.parse(cached);
      if (Date.now() < expiry) {
        return key;
      }
      sessionStorage.removeItem(getTeamCacheKey(teamSlug));
    }
  } catch (_err) {
    // Ignore cache errors
  }
  return null;
}

/**
 * Cache team key in sessionStorage
 * @param {string} teamSlug
 * @param {string} keyBase64
 */
export function cacheTeamKey(teamSlug, keyBase64) {
  try {
    const data = {
      key: keyBase64,
      expiry: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };
    sessionStorage.setItem(getTeamCacheKey(teamSlug), JSON.stringify(data));
  } catch (_err) {
    // Ignore cache errors
  }
}

/**
 * Clear cached team key
 * @param {string} teamSlug
 */
export function clearTeamKeyCache(teamSlug) {
  sessionStorage.removeItem(getTeamCacheKey(teamSlug));
}

// ============================================================
// Team URL Helper
// ============================================================

/**
 * Build a team-scoped API URL
 * @param {string} path - Path after /t/{slug}/api/team
 * @returns {string}
 */
function teamApiUrl(path) {
  const slug = state.session?.currentTeamSlug;
  if (!slug) {
    throw new Error("No team selected");
  }
  return `/t/${slug}/api/team${path}`;
}

// ============================================================
// Team Encryption Status
// ============================================================

/**
 * Fetch team encryption status from server
 * @returns {Promise<{initialized: boolean, teamPubkey: string|null}|null>}
 */
export async function getTeamEncryptionStatus() {
  try {
    const res = await fetch(teamApiUrl("/encryption"), {
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.warn("[TeamCrypto] Failed to get encryption status:", res.status);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("[TeamCrypto] Error fetching encryption status:", err);
    return null;
  }
}

// ============================================================
// Team Key Management
// ============================================================

/**
 * Fetch and unwrap the team key for the current user
 * @returns {Promise<string|null>} Base64-encoded team key
 */
export async function fetchTeamKey() {
  const teamSlug = state.session?.currentTeamSlug;
  if (!teamSlug) {
    console.warn("[TeamCrypto] No team selected");
    return null;
  }

  // Check cache first
  const cached = getCachedTeamKey(teamSlug);
  if (cached) return cached;

  try {
    const res = await fetch(teamApiUrl("/key"), {
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.warn("[TeamCrypto] No team key found, status:", res.status);
      return null;
    }
    const data = await res.json();

    if (!data.hasKey || !data.encryptedTeamKey) {
      console.log("[TeamCrypto] User has no team key stored");
      return null;
    }

    // Unwrap the key using NIP-44
    const teamKey = await unwrapKey(data.encryptedTeamKey);

    // Cache for future use
    cacheTeamKey(teamSlug, teamKey);

    return teamKey;
  } catch (err) {
    console.error("[TeamCrypto] Failed to fetch/unwrap team key:", err);
    return null;
  }
}

/**
 * Store the user's wrapped team key
 * @param {string} encryptedTeamKey - NIP-44 encrypted team key
 * @returns {Promise<boolean>}
 */
export async function storeUserTeamKey(encryptedTeamKey) {
  try {
    const res = await fetch(teamApiUrl("/key"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedTeamKey }),
    });

    if (!res.ok) {
      const data = await res.json();
      console.error("[TeamCrypto] Failed to store team key:", data.error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[TeamCrypto] Error storing team key:", err);
    return false;
  }
}

// ============================================================
// Invite Code Operations
// ============================================================

/**
 * Create an invite code with the encrypted team key
 * Called by admins when creating team invitations
 * @param {string} inviteCode - The plaintext invite code
 * @param {string} codeHash - SHA256 hash of the invite code (for server lookup)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function storeEncryptedKeyForInvite(inviteCode, codeHash) {
  try {
    const { nip44, pure } = await loadNostrLibs();

    // Get current user's secret key for NIP-44 encryption
    let creatorSecretKey;
    let creatorPubkey;

    if (window.nostr?.getPublicKey) {
      // Extension wallet - we'll need to use window.nostr.nip44.encrypt
      creatorPubkey = await window.nostr.getPublicKey();
    } else {
      // Ephemeral key - check sessionStorage first (key teleport), then localStorage
      const stored = sessionStorage.getItem(EPHEMERAL_SECRET_KEY) || localStorage.getItem(EPHEMERAL_SECRET_KEY);
      if (!stored) {
        return { success: false, error: "No signing key available" };
      }
      creatorSecretKey = hexToBytes(stored);
      creatorPubkey = pure.getPublicKey(creatorSecretKey);
    }

    // Get or generate team key
    let teamKey = await fetchTeamKey();
    let isFirstInvite = false;

    if (!teamKey) {
      // First invite - generate new team key
      console.log("[TeamCrypto] Generating new team key for first invite");
      teamKey = await generateChannelKey();
      isFirstInvite = true;
    }

    // Derive invite pubkey from code
    const invitePubkey = await derivePublicKeyFromCode(inviteCode);
    console.log("[TeamCrypto] Invite pubkey:", invitePubkey.slice(0, 16) + "...");

    // Encrypt team key to invite pubkey using NIP-44
    let encryptedTeamKey;
    if (window.nostr?.nip44?.encrypt) {
      // Use extension for encryption
      encryptedTeamKey = await window.nostr.nip44.encrypt(invitePubkey, teamKey);
    } else if (creatorSecretKey) {
      // Use local key
      const conversationKey = nip44.getConversationKey(creatorSecretKey, invitePubkey);
      encryptedTeamKey = nip44.encrypt(teamKey, conversationKey);
    } else {
      return { success: false, error: "Cannot encrypt without signing key" };
    }

    // If first invite, initialize team encryption on server
    if (isFirstInvite) {
      const initRes = await fetch(teamApiUrl("/init-encryption"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamPubkey: invitePubkey }),
      });

      if (!initRes.ok) {
        const data = await initRes.json();
        // Already initialized is OK
        if (!data.alreadyInitialized) {
          return { success: false, error: data.error || "Failed to initialize team encryption" };
        }
      }

      // Wrap team key for creator and store
      const creatorWrappedKey = await wrapKeyForUser(teamKey, creatorPubkey);
      const storeSuccess = await storeUserTeamKey(creatorWrappedKey);
      if (!storeSuccess) {
        console.warn("[TeamCrypto] Failed to store creator's team key");
      }

      // Cache the team key
      const teamSlug = state.session?.currentTeamSlug;
      if (teamSlug) {
        cacheTeamKey(teamSlug, teamKey);
      }
    }

    // Store encrypted key for this invite
    const storeRes = await fetch(teamApiUrl("/invite-key"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codeHash,
        encryptedTeamKey,
        creatorPubkey,
      }),
    });

    if (!storeRes.ok) {
      const data = await storeRes.json();
      return { success: false, error: data.error || "Failed to store invite key" };
    }

    return { success: true };
  } catch (err) {
    console.error("[TeamCrypto] Error storing encrypted key for invite:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Redeem an invite code to get the team key
 * Called when a user joins via invite
 * @param {string} inviteCode - The plaintext invite code
 * @param {string} teamSlug - The team slug to join
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function redeemInviteForTeamKey(inviteCode, teamSlug) {
  try {
    const { nip44, pure } = await loadNostrLibs();

    // Derive secret key from invite code
    const inviteSecretKey = await deriveSecretKeyFromCode(inviteCode);
    const invitePubkey = pure.getPublicKey(inviteSecretKey);
    console.log("[TeamCrypto] Derived invite pubkey:", invitePubkey.slice(0, 16) + "...");

    // Hash the code for server lookup
    const codeHash = await hashInviteCode(inviteCode);

    // Fetch encrypted team key for this invite
    const res = await fetch(`/t/${teamSlug}/api/team/invite-key?code=${encodeURIComponent(inviteCode)}`, {
      credentials: "same-origin",
    });

    if (!res.ok) {
      const data = await res.json();
      return { success: false, error: data.error || "Failed to get invite key" };
    }

    const { encryptedTeamKey, creatorPubkey } = await res.json();

    if (!encryptedTeamKey || !creatorPubkey) {
      console.log("[TeamCrypto] No encrypted team key found for invite");
      return { success: true }; // Not an error - team encryption may not be set up yet
    }

    console.log("[TeamCrypto] Got encrypted team key from creator:", creatorPubkey.slice(0, 16) + "...");

    // Decrypt team key using invite secret key
    const conversationKey = nip44.getConversationKey(inviteSecretKey, creatorPubkey);
    const teamKey = nip44.decrypt(encryptedTeamKey, conversationKey);
    console.log("[TeamCrypto] Decrypted team key, length:", teamKey.length);

    // Get user's pubkey - check sessionStorage first (key teleport), then localStorage
    let userPubkey;
    if (window.nostr?.getPublicKey) {
      userPubkey = await window.nostr.getPublicKey();
    } else {
      const stored = sessionStorage.getItem(EPHEMERAL_SECRET_KEY) || localStorage.getItem(EPHEMERAL_SECRET_KEY);
      if (!stored) {
        return { success: false, error: "No signing key available" };
      }
      userPubkey = pure.getPublicKey(hexToBytes(stored));
    }

    // Wrap team key for user
    const userWrappedKey = await wrapKeyForUser(teamKey, userPubkey);
    console.log("[TeamCrypto] Wrapped team key for user");

    // Store user's wrapped key
    const storeRes = await fetch(`/t/${teamSlug}/api/team/key`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedTeamKey: userWrappedKey }),
    });

    if (!storeRes.ok) {
      const data = await storeRes.json();
      return { success: false, error: data.error || "Failed to store team key" };
    }

    // Cache the team key
    cacheTeamKey(teamSlug, teamKey);
    console.log("[TeamCrypto] Team key cached successfully");

    return { success: true };
  } catch (err) {
    console.error("[TeamCrypto] Error redeeming invite:", err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// Team Message Encryption
// ============================================================

/**
 * Encrypt a message with the team key
 * @param {string} content - Plaintext message
 * @returns {Promise<{encrypted: string, keyVersion: number}|null>}
 */
export async function encryptMessageForTeam(content) {
  try {
    const { encryptAuthenticatedMessage } = await import("./crypto.js");

    const teamKey = await fetchTeamKey();
    if (!teamKey) {
      console.error("[TeamCrypto] No team key available for encryption");
      return null;
    }

    const encrypted = await encryptAuthenticatedMessage(content, teamKey);
    return { encrypted, keyVersion: 1 };
  } catch (err) {
    console.error("[TeamCrypto] Failed to encrypt message:", err);
    return null;
  }
}

/**
 * Decrypt a message encrypted with the team key
 * @param {string} ciphertext - Base64-encoded ciphertext
 * @returns {Promise<{content: string, sender: string, valid: boolean}|null>}
 */
export async function decryptMessageFromTeam(ciphertext) {
  try {
    const { decryptAuthenticatedMessage } = await import("./crypto.js");

    const teamKey = await fetchTeamKey();
    if (!teamKey) {
      console.error("[TeamCrypto] No team key available for decryption");
      return null;
    }

    const result = await decryptAuthenticatedMessage(ciphertext, teamKey);
    return result;
  } catch (err) {
    console.error("[TeamCrypto] Failed to decrypt message:", err);
    return null;
  }
}
