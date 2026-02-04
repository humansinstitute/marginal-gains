/**
 * E2E Encryption utilities for Marginal Gains
 * Uses AES-256-GCM for message encryption and NIP-44 for key wrapping
 */

import { loadNostrLibs, hexToBytes, bytesToHex } from "./nostr.js";
import { EPHEMERAL_SECRET_KEY } from "./constants.js";
import { isBunkerLogin, bunkerNip44Encrypt, bunkerNip44Decrypt, getBunkerUserPubkey, bunkerSignEvent } from "./bunkerCrypto.js";

// Event kind for encrypted message payloads (not published to relays)
export const ENCRYPTED_MESSAGE_KIND = 9420;

// Nonce length for AES-GCM (12 bytes recommended)
const NONCE_LENGTH = 12;

/**
 * Safely encode Uint8Array to base64 string
 * Avoids spread operator stack overflow and handles all byte values correctly
 * @param {Uint8Array} bytes - Binary data
 * @returns {string} Base64-encoded string
 */
function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Safely decode base64 string to Uint8Array
 * @param {string} base64 - Base64-encoded string
 * @returns {Uint8Array} Binary data
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Load NIP-44 module from nostr-tools
 */
export const loadNip44 = async () => {
  if (!window.__NIP44_LIB__) {
    const base = "https://esm.sh/nostr-tools@2.7.2";
    window.__NIP44_LIB__ = await import(`${base}/nip44?bundle`);
  }
  return window.__NIP44_LIB__;
};

/**
 * Generate a random AES-256-GCM symmetric key for channel encryption
 * @returns {Promise<string>} Base64-encoded raw key bytes
 */
export async function generateChannelKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable
    ["encrypt", "decrypt"]
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(rawKey));
}

/**
 * Import a base64-encoded key for use with Web Crypto
 * @param {string} keyBase64 - Base64-encoded raw key
 * @returns {Promise<CryptoKey>}
 */
async function importKey(keyBase64) {
  const keyBytes = base64ToBytes(keyBase64);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a message with AES-256-GCM
 * @param {string} plaintext - Message to encrypt
 * @param {string} keyBase64 - Base64-encoded channel key
 * @returns {Promise<string>} Base64-encoded ciphertext (nonce || ciphertext || tag)
 */
export async function encryptMessage(plaintext, keyBase64) {
  const key = await importKey(keyBase64);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const encoder = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    encoder.encode(plaintext)
  );

  // Combine nonce + ciphertext (tag is appended automatically by AES-GCM)
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce, 0);
  combined.set(new Uint8Array(ciphertext), nonce.length);

  return bytesToBase64(combined);
}

/**
 * Decrypt a message with AES-256-GCM
 * @param {string} ciphertextBase64 - Base64-encoded ciphertext
 * @param {string} keyBase64 - Base64-encoded channel key
 * @returns {Promise<string>} Decrypted plaintext
 * @throws {Error} If decryption fails
 */
export async function decryptMessage(ciphertextBase64, keyBase64) {
  const key = await importKey(keyBase64);
  const combined = base64ToBytes(ciphertextBase64);

  const nonce = combined.slice(0, NONCE_LENGTH);
  const ciphertext = combined.slice(NONCE_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Get the current user's private key (for ephemeral login) or null (for extension)
 * Checks sessionStorage first (PIN-protected sessions), then localStorage (legacy ephemeral)
 * @returns {Uint8Array|null}
 */
function getEphemeralSecretKey() {
  // Check sessionStorage first (PIN-protected nsec sessions)
  let stored = sessionStorage.getItem(EPHEMERAL_SECRET_KEY);
  // Fall back to localStorage (legacy ephemeral without PIN)
  if (!stored) {
    stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
  }
  if (!stored) return null;
  console.log("[Crypto] getEphemeralSecretKey - stored hex length:", stored.length);
  const bytes = hexToBytes(stored);
  console.log("[Crypto] getEphemeralSecretKey - bytes length:", bytes.length);
  if (bytes.length !== 32) {
    console.error("[Crypto] Invalid secret key length! Expected 32, got:", bytes.length);
  }
  return bytes;
}

/**
 * Check if encryption is available for the current user
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export async function checkEncryptionSupport() {
  // Web Crypto API requires secure context (HTTPS or localhost)
  if (!crypto?.subtle) {
    const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    return {
      available: false,
      reason: isLocalhost
        ? "Encryption requires a secure context. Try accessing via https://localhost instead."
        : "Encryption requires HTTPS. Please access this site over a secure connection.",
    };
  }

  // Check for NIP-07 extension with NIP-44 support
  if (window.nostr?.nip44?.encrypt) {
    return { available: true };
  }

  // Check for bunker (NIP-46) connection
  if (isBunkerLogin()) {
    return { available: true };
  }

  // Check for ephemeral key (includes PIN-protected nsec)
  const secretKey = getEphemeralSecretKey();
  if (secretKey) {
    return { available: true };
  }

  // No encryption method available
  if (window.nostr) {
    return {
      available: false,
      reason: "Your browser extension doesn't support NIP-44 encryption. Try using Sign Up (ephemeral login) instead, or update your extension.",
    };
  }

  return {
    available: false,
    reason: "No signing key available. Please log in first.",
  };
}

/**
 * Wrap a channel key for a recipient using NIP-44
 * @param {string} channelKeyBase64 - Base64-encoded channel key
 * @param {string} recipientPubkeyHex - Recipient's public key (hex)
 * @returns {Promise<string>} JSON structure with wrapped key
 */
export async function wrapKeyForUser(channelKeyBase64, recipientPubkeyHex) {
  console.log("[Crypto] wrapKeyForUser called");
  console.log("[Crypto] channelKeyBase64 length:", channelKeyBase64?.length);
  console.log("[Crypto] recipientPubkeyHex:", recipientPubkeyHex?.slice(0, 10) + "...");

  const nip44 = await loadNip44();
  let ciphertext;
  let createdBy;

  // Check if using NIP-07 extension with NIP-44 support
  if (window.nostr?.nip44?.encrypt) {
    console.log("[Crypto] Using NIP-07 extension for encryption");
    ciphertext = await window.nostr.nip44.encrypt(recipientPubkeyHex, channelKeyBase64);
    createdBy = await window.nostr.getPublicKey();
  } else if (isBunkerLogin()) {
    // Use bunker (NIP-46) for encryption
    console.log("[Crypto] Using bunker (NIP-46) for encryption");
    ciphertext = await bunkerNip44Encrypt(recipientPubkeyHex, channelKeyBase64);
    createdBy = await getBunkerUserPubkey();
    if (!createdBy) {
      throw new Error("Failed to get user pubkey from bunker");
    }
  } else {
    // Fallback to ephemeral key
    console.log("[Crypto] Using ephemeral key for encryption");
    const secretKey = getEphemeralSecretKey();
    if (!secretKey) {
      throw new Error("No encryption method available. Use a NIP-07 extension, bunker, or ephemeral login.");
    }
    const { pure } = await loadNostrLibs();
    // pure.getPublicKey already returns a hex string, don't double-encode!
    createdBy = pure.getPublicKey(secretKey);

    // Debug logging
    console.log("[Crypto] secretKey:", {
      type: secretKey?.constructor?.name,
      length: secretKey?.length,
      isUint8Array: secretKey instanceof Uint8Array,
    });
    console.log("[Crypto] recipientPubkeyHex:", {
      type: typeof recipientPubkeyHex,
      length: recipientPubkeyHex?.length,
      value: recipientPubkeyHex,
    });
    console.log("[Crypto] createdBy:", createdBy);

    // Validate key formats before calling NIP-44
    if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
      throw new Error(`Invalid secret key: expected 32-byte Uint8Array, got ${secretKey?.constructor?.name} of length ${secretKey?.length}`);
    }
    if (typeof recipientPubkeyHex !== 'string' || recipientPubkeyHex.length !== 64) {
      throw new Error(`Invalid pubkey: expected 64-char hex string, got ${typeof recipientPubkeyHex} of length ${recipientPubkeyHex?.length}`);
    }

    // NIP-44 v2: privkeyA as Uint8Array, pubkeyB as hex string (without prefix)
    const conversationKey = nip44.v2.utils.getConversationKey(secretKey, recipientPubkeyHex);
    console.log("[Crypto] Derived conversation key");
    ciphertext = nip44.v2.encrypt(channelKeyBase64, conversationKey);
    console.log("[Crypto] Encrypted, ciphertext type:", typeof ciphertext, "length:", ciphertext?.length);
  }

  const result = JSON.stringify({
    v: 1,
    alg: "nip44",
    key: ciphertext,
    created_by: createdBy,
    created_at: new Date().toISOString()
  });
  console.log("[Crypto] wrapKeyForUser result length:", result.length);
  return result;
}

/**
 * Unwrap a channel key using NIP-44
 * @param {string} wrappedKeyJson - JSON structure with wrapped key
 * @returns {Promise<string>} Base64-encoded channel key
 */
export async function unwrapKey(wrappedKeyJson) {
  const wrapped = JSON.parse(wrappedKeyJson);

  if (wrapped.v !== 1 || wrapped.alg !== "nip44") {
    throw new Error(`Unsupported key format: v${wrapped.v} alg=${wrapped.alg}`);
  }

  const nip44 = await loadNip44();
  const senderPubkey = wrapped.created_by;

  console.log("[Crypto] unwrapKey - attempting to decrypt key from sender:", senderPubkey?.slice(0, 16) + "...");

  // Check if using NIP-07 extension with NIP-44 support
  if (window.nostr?.nip44?.decrypt) {
    console.log("[Crypto] unwrapKey - using NIP-07 extension");
    try {
      const result = await window.nostr.nip44.decrypt(senderPubkey, wrapped.key);
      console.log("[Crypto] unwrapKey - NIP-07 decrypt succeeded");
      return result;
    } catch (err) {
      console.error("[Crypto] unwrapKey - NIP-07 decrypt failed:", err.message);
      console.error("[Crypto] This may indicate the key was wrapped for a different pubkey than your extension's");
      throw new Error(`Extension NIP-44 decrypt failed: ${err.message}. The key may have been encrypted for a different identity.`);
    }
  }

  // Check for bunker (NIP-46) connection
  if (isBunkerLogin()) {
    console.log("[Crypto] unwrapKey - using bunker (NIP-46)");
    try {
      const result = await bunkerNip44Decrypt(senderPubkey, wrapped.key);
      console.log("[Crypto] unwrapKey - bunker decrypt succeeded");
      return result;
    } catch (err) {
      console.error("[Crypto] unwrapKey - bunker decrypt failed:", err.message);
      throw new Error(`Bunker NIP-44 decrypt failed: ${err.message}. Check your remote signer connection.`);
    }
  }

  // Fallback to ephemeral key
  const secretKey = getEphemeralSecretKey();
  if (!secretKey) {
    console.error("[Crypto] unwrapKey - no decryption method available");
    console.error("[Crypto] Debug info:", {
      hasNostrExtension: !!window.nostr,
      hasNip44: !!window.nostr?.nip44,
      isBunker: isBunkerLogin(),
      hasSessionKey: !!sessionStorage.getItem(EPHEMERAL_SECRET_KEY),
      hasLocalKey: !!localStorage.getItem(EPHEMERAL_SECRET_KEY),
    });
    throw new Error("No decryption method available. Use a NIP-07 extension, bunker, or ephemeral login.");
  }

  console.log("[Crypto] unwrapKey - using ephemeral key");
  try {
    // NIP-44 v2: privkeyA as Uint8Array, pubkeyB as hex string
    const conversationKey = nip44.v2.utils.getConversationKey(secretKey, senderPubkey);
    const result = nip44.v2.decrypt(wrapped.key, conversationKey);
    console.log("[Crypto] unwrapKey - ephemeral decrypt succeeded");
    return result;
  } catch (err) {
    console.error("[Crypto] unwrapKey - ephemeral decrypt failed:", err.message);
    const { pure } = await loadNostrLibs();
    const myPubkey = pure.getPublicKey(secretKey);
    console.error("[Crypto] My ephemeral pubkey:", myPubkey?.slice(0, 16) + "...");
    console.error("[Crypto] Sender pubkey (created_by):", senderPubkey?.slice(0, 16) + "...");
    throw new Error(`Ephemeral NIP-44 decrypt failed: ${err.message}. Your current identity may not match the one the key was encrypted for.`);
  }
}

/**
 * Create a signed payload for encrypted messages using kind 9420 Nostr event
 * @param {string} content - Message content
 * @returns {Promise<string>} JSON string of signed Nostr event
 */
export async function createSignedPayload(content) {
  const { pure } = await loadNostrLibs();

  const unsignedEvent = {
    kind: ENCRYPTED_MESSAGE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content
  };

  // Check if using NIP-07 extension
  if (window.nostr?.signEvent) {
    unsignedEvent.pubkey = await window.nostr.getPublicKey();
    const signedEvent = await window.nostr.signEvent(unsignedEvent);
    return JSON.stringify(signedEvent);
  }

  // Check for bunker (NIP-46) connection
  if (isBunkerLogin()) {
    console.log("[Crypto] Using bunker (NIP-46) for signing");
    const signedEvent = await bunkerSignEvent(unsignedEvent);
    return JSON.stringify(signedEvent);
  }

  // Fallback to ephemeral key
  const secretKey = getEphemeralSecretKey();
  if (!secretKey) {
    throw new Error("No signing method available. Use a NIP-07 extension, bunker, or ephemeral login.");
  }

  const signedEvent = pure.finalizeEvent(unsignedEvent, secretKey);
  return JSON.stringify(signedEvent);
}

/**
 * Verify a signed payload and extract the content
 * @param {string} payloadJson - JSON string of signed Nostr event
 * @returns {{ valid: boolean, content: string, sender: string, ts: number }}
 */
export async function verifySignedPayload(payloadJson) {
  const { pure } = await loadNostrLibs();

  try {
    const event = JSON.parse(payloadJson);

    // Check if this is a legacy plain message (not a signed Nostr event)
    // Legacy messages don't have the required Nostr event fields
    const isSignedEvent = event.id && event.pubkey && event.sig && event.kind !== undefined;

    if (!isSignedEvent) {
      // Legacy format: plain message without signature
      // This can happen for messages encrypted before authenticated encryption was added
      console.log("[Crypto] verifySignedPayload - legacy plain message (no signature)");

      // If it has a 'content' field, use that; otherwise treat the whole thing as content
      const content = typeof event.content === "string" ? event.content : payloadJson;

      return {
        valid: true, // Trust it (decryption succeeded, that's authentication enough for legacy)
        content,
        sender: event.pubkey || "", // May not have sender for very old messages
        ts: event.created_at || 0,
        legacy: true, // Flag as legacy
      };
    }

    // Debug: log event structure before verification
    console.log("[Crypto] verifySignedPayload - signed event structure:", {
      idLength: event.id?.length,
      pubkeyLength: event.pubkey?.length,
      sigLength: event.sig?.length,
      kind: event.kind,
    });

    // Verify the event signature
    const valid = pure.verifyEvent(event);

    if (!valid) {
      console.warn("[Crypto] Event signature verification failed:", {
        id: event.id?.slice(0, 16) + "...",
        pubkey: event.pubkey?.slice(0, 16) + "...",
        sig: event.sig?.slice(0, 16) + "...",
        content: event.content?.slice(0, 50) + (event.content?.length > 50 ? "..." : ""),
      });
    }

    return {
      valid,
      content: event.content,
      sender: event.pubkey,
      ts: event.created_at
    };
  } catch (err) {
    // If JSON parse fails, this might be plain text content (very old format)
    console.log("[Crypto] verifySignedPayload - plain text content (not JSON)");
    return {
      valid: true, // Trust it - decryption succeeded
      content: payloadJson,
      sender: "",
      ts: 0,
      legacy: true,
    };
  }
}

/**
 * Encrypt a message with sender authentication
 * This creates a signed payload, then encrypts it with the channel key
 * @param {string} content - Message content
 * @param {string} channelKeyBase64 - Channel key
 * @returns {Promise<string>} Base64-encoded encrypted payload
 */
export async function encryptAuthenticatedMessage(content, channelKeyBase64) {
  const signedPayload = await createSignedPayload(content);
  return encryptMessage(signedPayload, channelKeyBase64);
}

/**
 * Decrypt and verify an authenticated message
 * @param {string} ciphertextBase64 - Encrypted payload
 * @param {string} channelKeyBase64 - Channel key
 * @returns {Promise<{ valid: boolean, content: string, sender: string, ts: number }>}
 */
export async function decryptAuthenticatedMessage(ciphertextBase64, channelKeyBase64) {
  try {
    const payloadJson = await decryptMessage(ciphertextBase64, channelKeyBase64);

    // Debug: log raw decrypted payload (first 200 chars)
    console.log("[Crypto] decryptAuthenticatedMessage - decrypted payload:",
      payloadJson?.slice(0, 200) + (payloadJson?.length > 200 ? "..." : ""));

    return verifySignedPayload(payloadJson);
  } catch (err) {
    console.error("Failed to decrypt authenticated message:", err);
    return {
      valid: false,
      content: "",
      sender: "",
      ts: 0
    };
  }
}
