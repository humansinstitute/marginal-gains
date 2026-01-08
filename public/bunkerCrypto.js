/**
 * Bunker (NIP-46) encryption operations
 * Handles NIP-44 encrypt/decrypt via remote signer
 */

import { BUNKER_CONNECTION_KEY } from "./constants.js";
import { loadNostrLibs, hexToBytes } from "./nostr.js";

/**
 * Check if user is logged in via bunker
 * @returns {boolean}
 */
export function isBunkerLogin() {
  return !!localStorage.getItem(BUNKER_CONNECTION_KEY);
}

/**
 * Get bunker connection data
 * @returns {{ clientSecretKey: string, remoteSignerPubkey: string, relays: string[] } | null}
 */
export function getBunkerConnection() {
  const json = localStorage.getItem(BUNKER_CONNECTION_KEY);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Send a request to the remote signer via NIP-46
 * @param {object} connection - Bunker connection data
 * @param {object} request - The request to send (method, params)
 * @returns {Promise<string>} The result from the signer
 */
async function requestFromSigner(connection, request) {
  const { clientSecretKey, remoteSignerPubkey, relays } = connection;
  const { pure, nip44, SimplePool } = await loadNostrLibs();

  const clientSecret = hexToBytes(clientSecretKey);
  const clientPubkey = pure.getPublicKey(clientSecret);
  const pool = new SimplePool();

  try {
    return await new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const fullRequest = { id: requestId, ...request };

      // Encrypt and send request
      const conversationKey = nip44.v2.utils.getConversationKey(clientSecret, remoteSignerPubkey);
      const encrypted = nip44.v2.encrypt(JSON.stringify(fullRequest), conversationKey);

      const requestEvent = pure.finalizeEvent(
        {
          kind: 24133,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["p", remoteSignerPubkey]],
          content: encrypted,
        },
        clientSecret
      );

      // Publish request
      console.log("[BunkerCrypto] Sending", request.method, "request to signer");
      pool.publish(relays, requestEvent);

      // Subscribe for response
      const sub = pool.subscribeMany(
        relays,
        [{ kinds: [24133], "#p": [clientPubkey], since: Math.floor(Date.now() / 1000) - 10 }],
        {
          onevent: async (event) => {
            try {
              const respConversationKey = nip44.v2.utils.getConversationKey(clientSecret, event.pubkey);
              const decrypted = nip44.v2.decrypt(event.content, respConversationKey);
              const message = JSON.parse(decrypted);

              if (message.id === requestId) {
                console.log("[BunkerCrypto] Received response for", request.method);
                sub.close();
                pool.close(relays);
                if (message.error) {
                  console.error("[BunkerCrypto] Signer error:", message.error);
                  reject(new Error(message.error));
                } else {
                  resolve(message.result);
                }
              }
            } catch (err) {
              console.error("[BunkerCrypto] Error parsing response:", err);
            }
          },
        }
      );

      // Timeout after 30 seconds
      setTimeout(() => {
        console.warn("[BunkerCrypto] Request timed out:", request.method);
        sub.close();
        pool.close(relays);
        reject(new Error("Bunker request timed out"));
      }, 30000);
    });
  } catch (err) {
    pool.close(relays);
    throw err;
  }
}

/**
 * Encrypt data using NIP-44 via remote signer (NIP-46)
 * @param {string} thirdPartyPubkey - The pubkey to encrypt to (hex)
 * @param {string} plaintext - The data to encrypt
 * @returns {Promise<string>} The encrypted ciphertext
 */
export async function bunkerNip44Encrypt(thirdPartyPubkey, plaintext) {
  const connection = getBunkerConnection();
  if (!connection) {
    throw new Error("No bunker connection available");
  }

  const result = await requestFromSigner(connection, {
    method: "nip44_encrypt",
    params: [thirdPartyPubkey, plaintext],
  });

  return result;
}

/**
 * Decrypt data using NIP-44 via remote signer (NIP-46)
 * @param {string} thirdPartyPubkey - The pubkey that encrypted the data (hex)
 * @param {string} ciphertext - The encrypted data
 * @returns {Promise<string>} The decrypted plaintext
 */
export async function bunkerNip44Decrypt(thirdPartyPubkey, ciphertext) {
  const connection = getBunkerConnection();
  if (!connection) {
    throw new Error("No bunker connection available");
  }

  const result = await requestFromSigner(connection, {
    method: "nip44_decrypt",
    params: [thirdPartyPubkey, ciphertext],
  });

  return result;
}

/**
 * Get the user's public key from the bunker connection
 * Note: This returns the user's actual pubkey (from session), not the client ephemeral pubkey
 * @returns {Promise<string|null>} The user's pubkey (hex)
 */
export async function getBunkerUserPubkey() {
  const connection = getBunkerConnection();
  if (!connection) return null;

  // The user pubkey should be in the session state, not the bunker connection
  // The bunker connection only has the client ephemeral key and remote signer pubkey
  // We need to get_public_key from the signer
  try {
    const result = await requestFromSigner(connection, {
      method: "get_public_key",
      params: [],
    });
    return result;
  } catch (err) {
    console.error("[BunkerCrypto] Failed to get user pubkey:", err);
    return null;
  }
}

/**
 * Sign an event using the remote signer (NIP-46)
 * @param {object} unsignedEvent - The unsigned Nostr event (kind, content, tags, created_at)
 * @returns {Promise<object>} The signed Nostr event
 */
export async function bunkerSignEvent(unsignedEvent) {
  const connection = getBunkerConnection();
  if (!connection) {
    throw new Error("No bunker connection available");
  }

  console.log("[BunkerCrypto] Signing event via bunker");
  const result = await requestFromSigner(connection, {
    method: "sign_event",
    params: [JSON.stringify(unsignedEvent)],
  });

  // Result is the signed event as JSON string
  return JSON.parse(result);
}
