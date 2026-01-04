/**
 * Chat encryption integration module
 * Handles encrypted channel operations and message encryption/decryption
 */

import {
  generateChannelKey,
  wrapKeyForUser,
  unwrapKey,
  encryptAuthenticatedMessage,
  decryptAuthenticatedMessage,
} from "./crypto.js";
import {
  fetchCommunityKey,
  getCachedCommunityKey,
} from "./communityCrypto.js";
import { state } from "./state.js";

// Key cache in sessionStorage (survives refresh, clears on tab close)
const KEY_CACHE_PREFIX = "mg_channel_key_";

/**
 * Get cached channel key from sessionStorage
 * @param {string} channelId
 * @returns {string|null} Base64-encoded channel key
 */
export function getCachedChannelKey(channelId) {
  try {
    const cached = sessionStorage.getItem(`${KEY_CACHE_PREFIX}${channelId}`);
    if (cached) {
      const { key, expiry } = JSON.parse(cached);
      // Check expiry (24 hours)
      if (Date.now() < expiry) {
        return key;
      }
      sessionStorage.removeItem(`${KEY_CACHE_PREFIX}${channelId}`);
    }
  } catch (_err) {
    // Ignore cache errors
  }
  return null;
}

/**
 * Cache channel key in sessionStorage
 * @param {string} channelId
 * @param {string} keyBase64
 */
export function cacheChannelKey(channelId, keyBase64) {
  try {
    const data = {
      key: keyBase64,
      expiry: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };
    sessionStorage.setItem(`${KEY_CACHE_PREFIX}${channelId}`, JSON.stringify(data));
  } catch (_err) {
    // Ignore cache errors
  }
}

/**
 * Clear cached key for a channel
 * @param {string} channelId
 */
export function clearCachedChannelKey(channelId) {
  sessionStorage.removeItem(`${KEY_CACHE_PREFIX}${channelId}`);
}

/**
 * Fetch and unwrap channel key from server
 * @param {string} channelId
 * @returns {Promise<string|null>} Base64-encoded channel key
 */
export async function fetchChannelKey(channelId) {
  // Check cache first
  const cached = getCachedChannelKey(channelId);
  if (cached) return cached;

  try {
    const res = await fetch(`/chat/channels/${channelId}/keys`, {
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.warn("[ChatCrypto] No key found for channel", channelId, "status:", res.status);
      return null;
    }
    const data = await res.json();
    const wrappedKey = data.encrypted_key;

    // Unwrap the key using NIP-44
    const channelKey = await unwrapKey(wrappedKey);

    // Cache for future use
    cacheChannelKey(channelId, channelKey);

    return channelKey;
  } catch (err) {
    console.error("[ChatCrypto] Failed to fetch/unwrap key:", err);
    return null;
  }
}

/**
 * Generate and store encryption key for a new channel
 * @param {string} channelId
 * @param {string} ownerPubkey - Channel owner's pubkey (hex)
 * @returns {Promise<boolean>} Success
 */
export async function setupChannelEncryption(channelId, ownerPubkey) {
  try {
    // Generate new AES-256 channel key
    const channelKey = await generateChannelKey();

    // Wrap key for the owner
    const wrappedKey = await wrapKeyForUser(channelKey, ownerPubkey);

    // Store wrapped key on server
    const res = await fetch(`/chat/channels/${channelId}/keys`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPubkey: ownerPubkey,
        encryptedKey: wrappedKey,
        keyVersion: 1,
      }),
    });

    if (!res.ok) {
      console.error("[ChatCrypto] Failed to store channel key, status:", res.status);
      return false;
    }

    // Cache the key locally
    cacheChannelKey(channelId, channelKey);

    return true;
  } catch (err) {
    console.error("[ChatCrypto] Failed to setup channel encryption:", err);
    return false;
  }
}

/**
 * Set up encryption for a personal "Note to self" channel
 * Generates a key and wraps it only for the owner
 * @param {string} channelId
 * @returns {Promise<boolean>} Success
 */
async function setupPersonalChannelEncryption(channelId) {
  try {
    // Get current user's pubkey
    const userPubkey = await getCurrentUserPubkey();
    if (!userPubkey) {
      console.error("[ChatCrypto] Cannot setup personal encryption - no user pubkey");
      return false;
    }

    console.log("[ChatCrypto] Setting up personal channel encryption for", channelId);

    // Generate new AES-256 channel key
    const channelKey = await generateChannelKey();

    // Wrap key for the owner (self)
    const wrappedKey = await wrapKeyForUser(channelKey, userPubkey);

    // Store wrapped key on server
    const res = await fetch(`/chat/channels/${channelId}/keys`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPubkey,
        encryptedKey: wrappedKey,
        keyVersion: 1,
      }),
    });

    if (!res.ok) {
      console.error("[ChatCrypto] Failed to store personal channel key, status:", res.status);
      return false;
    }

    // Cache the key locally
    cacheChannelKey(channelId, channelKey);

    console.log("[ChatCrypto] Personal channel encryption set up successfully");
    return true;
  } catch (err) {
    console.error("[ChatCrypto] Failed to setup personal channel encryption:", err);
    return false;
  }
}

/**
 * Get current user's public key (hex)
 * @returns {Promise<string|null>}
 */
async function getCurrentUserPubkey() {
  // Try browser extension first
  if (window.nostr?.getPublicKey) {
    return window.nostr.getPublicKey();
  }

  // Try from state (session pubkey)
  if (state.session?.pubkey) {
    return state.session.pubkey;
  }

  return null;
}

/**
 * Distribute channel key to a new member
 * @param {string} channelId
 * @param {string} memberPubkey - New member's pubkey (hex)
 * @returns {Promise<boolean>} Success
 */
export async function distributeKeyToMember(channelId, memberPubkey) {
  try {
    // Get the channel key (from cache or server)
    const channelKey = await fetchChannelKey(channelId);
    if (!channelKey) {
      console.error("[ChatCrypto] Cannot distribute key - no channel key available");
      return false;
    }

    // Wrap key for the new member
    const wrappedKey = await wrapKeyForUser(channelKey, memberPubkey);

    // Store wrapped key on server
    const res = await fetch(`/chat/channels/${channelId}/keys`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userPubkey: memberPubkey,
        encryptedKey: wrappedKey,
      }),
    });

    if (!res.ok) {
      console.warn("[ChatCrypto] Failed to store key for member, status:", res.status);
    }
    return res.ok;
  } catch (err) {
    console.error("[ChatCrypto] Failed to distribute key:", err);
    return false;
  }
}

/**
 * Get members who need encryption keys for a channel
 * @param {string} channelId
 * @returns {Promise<Array<{npub: string, pubkey: string, displayName: string|null}>>}
 */
export async function getPendingKeyMembers(channelId) {
  try {
    const res = await fetch(`/chat/channels/${channelId}/keys/pending`, {
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.warn("[ChatCrypto] Failed to get pending members, status:", res.status);
      return [];
    }
    const data = await res.json();
    return data.pendingMembers || [];
  } catch (err) {
    console.error("[ChatCrypto] Failed to get pending key members:", err);
    return [];
  }
}

/**
 * Distribute keys to all pending members
 * @param {string} channelId
 * @returns {Promise<{success: number, failed: number}>}
 */
export async function distributeKeysToAllPendingMembers(channelId) {
  const pending = await getPendingKeyMembers(channelId);
  if (pending.length === 0) {
    return { success: 0, failed: 0 };
  }

  console.log(`[ChatCrypto] Distributing keys to ${pending.length} pending members`);

  let success = 0;
  let failed = 0;

  for (const member of pending) {
    const ok = await distributeKeyToMember(channelId, member.pubkey);
    if (ok) {
      console.log(`[ChatCrypto] Distributed key to ${member.displayName || member.npub}`);
      success++;
    } else {
      console.error(`[ChatCrypto] Failed to distribute key to ${member.displayName || member.npub}`);
      failed++;
    }
  }

  return { success, failed };
}

/**
 * Encrypt a message for a channel (uses appropriate key type)
 * @param {string} content - Plaintext message
 * @param {string} channelId
 * @returns {Promise<{encrypted: string, keyVersion: number}|null>}
 */
export async function encryptMessageForChannel(content, channelId) {
  try {
    let key;

    // Check if this is a per-channel encrypted channel (private/DM)
    if (isChannelEncrypted(channelId)) {
      key = await fetchChannelKey(channelId);
    }
    // Personal "Note to self" uses per-channel key (encrypted to self)
    else if (isPersonalChannel(channelId)) {
      key = await fetchChannelKey(channelId);
      // If no key exists yet, set up encryption for personal channel
      if (!key) {
        const setup = await setupPersonalChannelEncryption(channelId);
        if (setup) {
          key = await fetchChannelKey(channelId);
        }
      }
    }
    // Otherwise check for community encryption (public channels)
    else if (usesCommunityEncryption(channelId)) {
      key = await fetchCommunityKey();
    }

    if (!key) {
      console.error("[ChatCrypto] No key available for encryption");
      return null;
    }

    const encrypted = await encryptAuthenticatedMessage(content, key);
    return { encrypted, keyVersion: 1 };
  } catch (err) {
    console.error("[ChatCrypto] Failed to encrypt message:", err);
    return null;
  }
}

/**
 * Decrypt a message from a channel (uses appropriate key type)
 * @param {string} ciphertext - Encrypted message (base64)
 * @param {string} channelId
 * @returns {Promise<{content: string, sender: string, valid: boolean}|null>}
 */
export async function decryptMessageFromChannel(ciphertext, channelId) {
  try {
    let key;

    // Check if this is a per-channel encrypted channel (private/DM)
    if (isChannelEncrypted(channelId)) {
      key = await fetchChannelKey(channelId);
    }
    // Personal "Note to self" uses per-channel key
    else if (isPersonalChannel(channelId)) {
      key = await fetchChannelKey(channelId);
    }
    // Otherwise check for community encryption (public channels)
    else if (usesCommunityEncryption(channelId)) {
      key = await fetchCommunityKey();
    }

    if (!key) {
      console.error("[ChatCrypto] No key available for decryption");
      return null;
    }

    const result = await decryptAuthenticatedMessage(ciphertext, key);
    return result;
  } catch (err) {
    console.error("[ChatCrypto] Failed to decrypt message:", err);
    return null;
  }
}

/**
 * Check if a channel uses per-channel encryption (private/DM)
 * @param {string} channelId
 * @returns {boolean}
 */
export function isChannelEncrypted(channelId) {
  // Check regular channels
  const channel = state.chat.channels.find((c) => c.id === channelId);
  if (channel?.encrypted) return true;

  // Check DM channels
  const dm = state.chat.dmChannels.find((c) => c.id === channelId);
  if (dm?.encrypted) return true;

  return false;
}

/**
 * Check if a channel uses community-wide encryption (public channels)
 * @param {string} channelId
 * @returns {boolean}
 */
export function usesCommunityEncryption(channelId) {
  // Check if community encryption is active (user has community key)
  const hasCommunityKey = !!getCachedCommunityKey();
  if (!hasCommunityKey) return false;

  // Personal channels use self-encryption, not community encryption
  if (state.chat.personalChannel?.id === channelId) {
    return false;
  }

  // Public channels use community encryption when available
  const channel = state.chat.channels.find((c) => c.id === channelId);
  if (channel && !channel.private && !channel.encrypted) {
    return true;
  }

  return false;
}

/**
 * Check if a channel is a personal "Note to self" channel
 * @param {string} channelId
 * @returns {boolean}
 */
export function isPersonalChannel(channelId) {
  return state.chat.personalChannel?.id === channelId;
}

/**
 * Check if a channel needs any form of encryption
 * @param {string} channelId
 * @returns {boolean}
 */
export function channelNeedsEncryption(channelId) {
  return isChannelEncrypted(channelId) || usesCommunityEncryption(channelId) || isPersonalChannel(channelId);
}

/**
 * Process messages for display - decrypt encrypted ones
 * @param {Array} messages - Array of message objects
 * @param {string} channelId
 * @returns {Promise<Array>} Messages with decrypted content
 */
export async function processMessagesForDisplay(messages, channelId) {
  // Check if any messages need decryption
  const hasEncryptedMessages = messages.some((m) => m.encrypted);
  if (!hasEncryptedMessages) return messages;

  // Determine which key to use
  let key = null;
  const isPerChannelEncrypted = isChannelEncrypted(channelId);
  const isPersonal = isPersonalChannel(channelId);
  const isCommunityEncrypted = usesCommunityEncryption(channelId);

  if (isPerChannelEncrypted || isPersonal) {
    key = await fetchChannelKey(channelId);
  } else if (isCommunityEncrypted) {
    key = await fetchCommunityKey();
  }

  if (!key) {
    // Return messages with placeholder for encrypted content
    return messages.map((m) => ({
      ...m,
      body: m.encrypted ? "[Unable to decrypt - no key available]" : m.body,
      decryptionFailed: m.encrypted,
    }));
  }

  // Decrypt each encrypted message
  const processed = await Promise.all(
    messages.map(async (m) => {
      if (!m.encrypted) return m;

      try {
        const result = await decryptAuthenticatedMessage(m.body, key);
        if (result.valid) {
          return {
            ...m,
            body: result.content,
            decryptedSender: result.sender,
            isEncrypted: true,
          };
        } else {
          return {
            ...m,
            body: "[Message signature invalid]",
            decryptionFailed: true,
          };
        }
      } catch (_err) {
        return {
          ...m,
          body: "[Decryption failed]",
          decryptionFailed: true,
        };
      }
    })
  );

  return processed;
}
