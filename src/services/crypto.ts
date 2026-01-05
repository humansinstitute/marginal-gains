/**
 * Server-side crypto utilities for Wingman
 * Handles key unwrapping (NIP-44) and message decryption (AES-GCM)
 */

import { nip44 } from "nostr-tools";

import { getWingmanIdentity } from "../config";
import { getCommunityKey, getUserChannelKey, getChannel, isCommunityBootstrapped } from "../db";

// AES-GCM nonce length (12 bytes)
const NONCE_LENGTH = 12;

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Unwrap a NIP-44 encrypted key using Wingman's secret key
 * @param wrappedKeyJson - JSON structure with wrapped key
 * @param senderPubkey - Public key of the sender (who wrapped the key)
 * @returns Base64-encoded decrypted key or null
 */
export function unwrapKeyForWingman(wrappedKeyJson: string): string | null {
  const identity = getWingmanIdentity();
  if (!identity) {
    console.error("[Crypto] No Wingman identity available");
    return null;
  }

  try {
    const wrapped = JSON.parse(wrappedKeyJson);

    if (wrapped.v !== 1 || wrapped.alg !== "nip44") {
      console.error(`[Crypto] Unsupported key format: v${wrapped.v} alg=${wrapped.alg}`);
      return null;
    }

    const senderPubkey = wrapped.created_by;
    const secretKeyHex = bytesToHex(identity.secretKey);

    // NIP-44 v2: derive conversation key then decrypt
    const conversationKey = nip44.v2.utils.getConversationKey(secretKeyHex, senderPubkey);
    const decryptedKey = nip44.v2.decrypt(wrapped.key, conversationKey);

    return decryptedKey;
  } catch (err) {
    console.error("[Crypto] Failed to unwrap key:", err);
    return null;
  }
}

/**
 * Import a base64-encoded key for use with Web Crypto
 */
async function importKey(keyBase64: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

/**
 * Decrypt an AES-GCM encrypted message
 * @param ciphertextBase64 - Base64-encoded ciphertext (nonce || ciphertext || tag)
 * @param keyBase64 - Base64-encoded AES key
 * @returns Decrypted plaintext or null
 */
export async function decryptMessage(
  ciphertextBase64: string,
  keyBase64: string
): Promise<string | null> {
  try {
    const key = await importKey(keyBase64);
    const combined = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));

    const nonce = combined.slice(0, NONCE_LENGTH);
    const ciphertext = combined.slice(NONCE_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error("[Crypto] Failed to decrypt message:", err);
    return null;
  }
}

/**
 * Decrypt and verify an authenticated message (signed Nostr event inside)
 * @param ciphertextBase64 - Base64-encoded ciphertext
 * @param keyBase64 - Base64-encoded AES key
 * @returns Object with content, sender, validity or null
 */
export async function decryptAuthenticatedMessage(
  ciphertextBase64: string,
  keyBase64: string
): Promise<{ content: string; sender: string; valid: boolean } | null> {
  try {
    const payloadJson = await decryptMessage(ciphertextBase64, keyBase64);
    if (!payloadJson) return null;

    // Parse the signed Nostr event
    const event = JSON.parse(payloadJson);

    // Basic validation (full signature verification could be added)
    const valid = event.pubkey && event.content !== undefined && event.sig;

    return {
      content: event.content,
      sender: event.pubkey,
      valid: !!valid,
    };
  } catch (err) {
    console.error("[Crypto] Failed to decrypt authenticated message:", err);
    return null;
  }
}

export interface WingmanChannelAccess {
  hasAccess: boolean;
  key: string | null;
  reason?: string;
}

/**
 * Check if Wingman has access to a channel's encryption and get the key
 * @param channelId - Channel ID
 * @returns Access status and decrypted key if available
 */
export function getWingmanChannelAccess(channelId: number): WingmanChannelAccess {
  const identity = getWingmanIdentity();
  if (!identity) {
    return { hasAccess: false, key: null, reason: "Wingman not configured" };
  }

  const channel = getChannel(channelId);
  if (!channel) {
    return { hasAccess: false, key: null, reason: "Channel not found" };
  }

  // Check if channel is a personal channel (Note to self)
  if (channel.owner_npub) {
    return {
      hasAccess: false,
      key: null,
      reason: "I can't access personal notes - they're encrypted to you only.",
    };
  }

  // Check for per-channel encryption (private channels, DMs)
  if (channel.encrypted) {
    const wrappedKey = getUserChannelKey(identity.pubkey, channelId);
    if (!wrappedKey) {
      return {
        hasAccess: false,
        key: null,
        reason: "I don't have access to this private channel. Add me to the group to enable AI assistance.",
      };
    }

    const decryptedKey = unwrapKeyForWingman(wrappedKey.encrypted_key);
    if (!decryptedKey) {
      return {
        hasAccess: false,
        key: null,
        reason: "Failed to decrypt channel key.",
      };
    }

    return { hasAccess: true, key: decryptedKey };
  }

  // Check for community encryption (public channels)
  if (isCommunityBootstrapped()) {
    const wrappedCommunityKey = getCommunityKey(identity.pubkey);
    if (!wrappedCommunityKey) {
      return {
        hasAccess: false,
        key: null,
        reason: "I haven't been onboarded to this community yet. Ask an admin to add me.",
      };
    }

    const decryptedKey = unwrapKeyForWingman(wrappedCommunityKey.encrypted_key);
    if (!decryptedKey) {
      return {
        hasAccess: false,
        key: null,
        reason: "Failed to decrypt community key.",
      };
    }

    return { hasAccess: true, key: decryptedKey };
  }

  // No encryption on this channel
  return { hasAccess: true, key: null };
}

/**
 * Decrypt a message body for Wingman if needed
 * @param body - Message body (may be encrypted)
 * @param encrypted - Whether the message is encrypted
 * @param channelId - Channel ID for key lookup
 * @returns Decrypted content or original body
 */
export async function decryptMessageForWingman(
  body: string,
  encrypted: boolean,
  channelId: number
): Promise<{ content: string; decrypted: boolean; error?: string }> {
  if (!encrypted) {
    return { content: body, decrypted: false };
  }

  const access = getWingmanChannelAccess(channelId);
  if (!access.hasAccess || !access.key) {
    return {
      content: "[Encrypted message]",
      decrypted: false,
      error: access.reason,
    };
  }

  const result = await decryptAuthenticatedMessage(body, access.key);
  if (!result) {
    return {
      content: "[Failed to decrypt]",
      decrypted: false,
      error: "Decryption failed",
    };
  }

  return { content: result.content, decrypted: true };
}
