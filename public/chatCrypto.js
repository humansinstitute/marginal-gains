/**
 * Chat encryption integration module
 * Handles encrypted channel operations and message encryption/decryption
 */

import { chatUrl } from "./api.js";
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
import {
  fetchTeamKey,
  getCachedTeamKey,
} from "./teamCrypto.js";
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
    const res = await fetch(chatUrl(`/channels/${channelId}/keys`), {
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
    const res = await fetch(chatUrl(`/channels/${channelId}/keys`), {
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
    const res = await fetch(chatUrl(`/channels/${channelId}/keys`), {
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
    const res = await fetch(chatUrl(`/channels/${channelId}/keys`), {
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
    const res = await fetch(chatUrl(`/channels/${channelId}/keys/pending`), {
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

    // Debug: log which path we're taking
    const channelEncrypted = isChannelEncrypted(channelId);
    const personalChannel = isPersonalChannel(channelId);
    const communityEncrypted = usesCommunityEncryption(channelId);

    console.log("[ChatCrypto] encryptMessageForChannel debug:", {
      channelId,
      isChannelEncrypted: channelEncrypted,
      isPersonalChannel: personalChannel,
      usesCommunityEncryption: communityEncrypted,
      channelNeedsEncryption: channelEncrypted || personalChannel || communityEncrypted,
    });

    // Check if this is a per-channel encrypted channel (private/DM)
    if (channelEncrypted) {
      console.log("[ChatCrypto] Fetching per-channel key...");
      key = await fetchChannelKey(channelId);
      console.log("[ChatCrypto] Per-channel key result:", key ? "found" : "NOT FOUND");
    }
    // Personal "Note to self" uses per-channel key (encrypted to self)
    else if (personalChannel) {
      console.log("[ChatCrypto] Fetching personal channel key...");
      key = await fetchChannelKey(channelId);
      // If no key exists yet, set up encryption for personal channel
      if (!key) {
        console.log("[ChatCrypto] No personal key, setting up...");
        const setup = await setupPersonalChannelEncryption(channelId);
        if (setup) {
          key = await fetchChannelKey(channelId);
        }
      }
    }
    // Otherwise check for community/team encryption (public channels)
    else if (communityEncrypted) {
      console.log("[ChatCrypto] Fetching team/community key...");
      key = await fetchPublicChannelKey();
      console.log("[ChatCrypto] Team/community key result:", key ? "found" : "NOT FOUND");
    }

    if (!key) {
      console.error("[ChatCrypto] No key available for encryption - none of the paths returned a key");
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
    // Otherwise check for community/team encryption (public channels)
    else if (usesCommunityEncryption(channelId)) {
      key = await fetchPublicChannelKey();
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
  // Normalize to string for comparison (state stores string IDs)
  const idStr = String(channelId);

  // Check regular channels
  const channel = state.chat.channels.find((c) => c.id === idStr);

  // Debug logging
  console.log("[ChatCrypto] isChannelEncrypted check:", {
    channelId,
    idStr,
    channelFound: !!channel,
    channelEncrypted: channel?.encrypted,
    allChannelIds: state.chat.channels.map(c => c.id),
  });

  if (channel?.encrypted) return true;

  // Check DM channels
  const dm = state.chat.dmChannels.find((c) => c.id === idStr);
  if (dm?.encrypted) return true;

  return false;
}

/**
 * Check if we're in a team context
 * @returns {boolean}
 */
export function isInTeamContext() {
  return !!state.session?.currentTeamSlug;
}

/**
 * Check if a channel uses team/community-wide encryption (public channels)
 * In team context: uses team key
 * In global context: uses community key
 * @param {string} channelId
 * @returns {boolean}
 */
export function usesCommunityEncryption(channelId) {
  // Normalize to string for comparison
  const idStr = String(channelId);

  // Check if team or community encryption is active (user has appropriate key)
  let hasKey = false;
  const inTeamContext = isInTeamContext();
  if (inTeamContext) {
    hasKey = !!getCachedTeamKey(state.session.currentTeamSlug);
  } else {
    hasKey = !!getCachedCommunityKey();
  }

  console.log("[ChatCrypto] usesCommunityEncryption check:", {
    channelId,
    idStr,
    inTeamContext,
    teamSlug: state.session?.currentTeamSlug,
    hasTeamKey: inTeamContext ? !!getCachedTeamKey(state.session?.currentTeamSlug) : "N/A",
    hasCommunityKey: !inTeamContext ? !!getCachedCommunityKey() : "N/A",
    hasKey,
  });

  if (!hasKey) return false;

  // Personal channels use self-encryption, not community/team encryption
  if (String(state.chat.personalChannel?.id) === idStr) {
    return false;
  }

  // Public channels use community/team encryption when available
  const channel = state.chat.channels.find((c) => c.id === idStr);

  console.log("[ChatCrypto] usesCommunityEncryption channel check:", {
    channelFound: !!channel,
    channelPrivate: channel?.private,
    channelEncrypted: channel?.encrypted,
    willReturnTrue: channel && !channel.private && !channel.encrypted,
  });

  if (channel && !channel.private && !channel.encrypted) {
    return true;
  }

  return false;
}

/**
 * Fetch the appropriate public channel key (team or community)
 * @returns {Promise<string|null>} Base64-encoded key
 */
export async function fetchPublicChannelKey() {
  if (isInTeamContext()) {
    return fetchTeamKey();
  }
  return fetchCommunityKey();
}

/**
 * Get cached public channel key (team or community)
 * @returns {string|null} Base64-encoded key
 */
export function getCachedPublicChannelKey() {
  if (isInTeamContext()) {
    return getCachedTeamKey(state.session.currentTeamSlug);
  }
  return getCachedCommunityKey();
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
  const channelEncrypted = isChannelEncrypted(channelId);
  const communityEncrypted = usesCommunityEncryption(channelId);
  const personalChannel = isPersonalChannel(channelId);

  console.log("[ChatCrypto] channelNeedsEncryption:", {
    channelId,
    isChannelEncrypted: channelEncrypted,
    usesCommunityEncryption: communityEncrypted,
    isPersonalChannel: personalChannel,
    result: channelEncrypted || communityEncrypted || personalChannel,
  });

  return channelEncrypted || communityEncrypted || personalChannel;
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

  console.log("[ChatCrypto] processMessagesForDisplay debug:", {
    channelId,
    messageCount: messages.length,
    encryptedCount: messages.filter(m => m.encrypted).length,
    isPerChannelEncrypted,
    isPersonal,
    isCommunityEncrypted,
  });

  if (isPerChannelEncrypted || isPersonal) {
    console.log("[ChatCrypto] Fetching per-channel/personal key for decryption...");
    key = await fetchChannelKey(channelId);
  } else if (isCommunityEncrypted) {
    console.log("[ChatCrypto] Fetching team/community key for decryption...");
    key = await fetchPublicChannelKey();
  } else {
    console.warn("[ChatCrypto] No encryption type matched! Messages are encrypted but no key path available");
  }

  console.log("[ChatCrypto] Key fetch result:", key ? "found" : "NOT FOUND");

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

/**
 * Setup encryption for a DM channel
 * Generates a channel key and distributes to both participants
 * @param {object} dmChannel - DM channel object with id and participants
 * @returns {Promise<boolean>} True if setup succeeded
 */
export async function setupDmEncryption(dmChannel) {
  const channelId = dmChannel.id;

  // Check if already encrypted
  if (dmChannel.encrypted) {
    console.log(`[ChatCrypto] DM ${channelId} already encrypted`);
    return true;
  }

  // Get both participants
  const myPubkey = state.session?.pubkey;
  const otherNpub = dmChannel.otherNpub;

  if (!myPubkey || !otherNpub) {
    console.error("[ChatCrypto] Cannot setup DM encryption: missing participant info");
    return false;
  }

  // Convert otherNpub to hex pubkey if needed
  let otherPubkey = otherNpub;
  if (otherNpub.startsWith("npub1")) {
    // Need to decode npub to hex - use nostr-tools if available
    try {
      const { nip19 } = await import("https://esm.sh/nostr-tools@2.10.4");
      const decoded = nip19.decode(otherNpub);
      otherPubkey = decoded.data;
    } catch (err) {
      console.error("[ChatCrypto] Failed to decode npub:", err);
      return false;
    }
  }

  try {
    console.log(`[ChatCrypto] Setting up encryption for DM ${channelId}`);

    // Generate channel key
    const channelKey = await generateChannelKey();

    // Wrap key for both participants
    const myWrappedKey = await wrapKeyForUser(channelKey, myPubkey);
    const otherWrappedKey = await wrapKeyForUser(channelKey, otherPubkey);

    // Store keys via batch endpoint
    const res = await fetch(chatUrl(`/channels/${channelId}/keys/batch`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keys: [
          { userPubkey: myPubkey, encryptedKey: myWrappedKey },
          { userPubkey: otherPubkey, encryptedKey: otherWrappedKey },
        ],
        setEncrypted: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[ChatCrypto] Failed to store DM keys:", err);
      return false;
    }

    // Cache the key locally
    cacheChannelKey(channelId, channelKey);

    // Update local state
    dmChannel.encrypted = true;

    console.log(`[ChatCrypto] DM ${channelId} encryption setup complete`);
    return true;
  } catch (err) {
    console.error("[ChatCrypto] Error setting up DM encryption:", err);
    return false;
  }
}

/**
 * Setup encryption for all DMs that don't have it yet
 * Called on chat load when community encryption is active
 * @returns {Promise<void>}
 */
export async function setupAllDmEncryption() {
  const dmChannels = state.chat?.dmChannels || [];

  if (dmChannels.length === 0) {
    return;
  }

  console.log(`[ChatCrypto] Checking ${dmChannels.length} DMs for encryption setup`);

  // Filter to DMs without encryption
  const unencryptedDms = dmChannels.filter(dm => !dm.encrypted);

  if (unencryptedDms.length === 0) {
    console.log("[ChatCrypto] All DMs already encrypted");
    return;
  }

  console.log(`[ChatCrypto] Setting up encryption for ${unencryptedDms.length} DMs`);

  // Setup encryption for each (sequentially to avoid overwhelming the server)
  for (const dm of unencryptedDms) {
    await setupDmEncryption(dm);
  }

  console.log("[ChatCrypto] DM encryption setup complete");
}
