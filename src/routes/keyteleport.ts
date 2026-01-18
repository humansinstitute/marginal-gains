/**
 * Key Teleport route handler
 * Handles secure key import from external key manager via NIP-44 encrypted payloads
 */

import { nip44, verifyEvent } from "nostr-tools";

import { getKeyTeleportIdentity, getKeyTeleportWelcomePubkey } from "../config";
import { jsonResponse, safeJson } from "../http";

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface KeyTeleportRequest {
  blob: string;
}

interface KeyTeleportPayload {
  apiRoute: string;
  hash_id: string;
  timestamp: number;
}

interface KeyManagerResponse {
  ncryptsec: string;
}

/**
 * Handle POST /api/keyteleport
 * 1. Decrypt the NIP-44 encrypted blob
 * 2. Verify the signature is from the welcome pubkey
 * 3. Fetch the ncryptsec from the key manager
 * 4. Return ncryptsec to client
 */
export async function handleKeyTeleport(req: Request): Promise<Response> {
  // Check if Key Teleport is configured
  const identity = getKeyTeleportIdentity();
  const welcomePubkey = getKeyTeleportWelcomePubkey();

  if (!identity || !welcomePubkey) {
    return jsonResponse({ error: "Key Teleport not configured" }, 503);
  }

  // Parse request body
  const body = (await safeJson(req)) as KeyTeleportRequest | null;
  if (!body?.blob) {
    return jsonResponse({ error: "Missing blob parameter" }, 400);
  }

  try {
    // The blob is a NIP-44 encrypted Nostr event
    // First, we need to decrypt it using our private key
    // The blob format is: base64(nip44_encrypted_event_json)

    // Decode the base64 blob to get the encrypted event
    let encryptedContent: string;
    try {
      encryptedContent = atob(body.blob);
    } catch {
      return jsonResponse({ error: "Invalid blob encoding" }, 400);
    }

    // Parse the encrypted event wrapper
    let eventWrapper: { pubkey: string; content: string; sig: string; id: string; kind: number; created_at: number; tags: string[][] };
    try {
      eventWrapper = JSON.parse(encryptedContent);
    } catch {
      return jsonResponse({ error: "Invalid event format" }, 400);
    }

    // Verify the event signature
    if (!verifyEvent(eventWrapper)) {
      return jsonResponse({ error: "Invalid event signature" }, 400);
    }

    // Verify the event is from the trusted welcome pubkey
    if (eventWrapper.pubkey !== welcomePubkey) {
      console.error(`[KeyTeleport] Event from untrusted pubkey: ${eventWrapper.pubkey.slice(0, 16)}...`);
      return jsonResponse({ error: "Untrusted source" }, 403);
    }

    // Decrypt the event content using NIP-44
    const secretKeyHex = bytesToHex(identity.secretKey);
    const conversationKey = nip44.v2.utils.getConversationKey(secretKeyHex, eventWrapper.pubkey);

    let decryptedContent: string;
    try {
      decryptedContent = nip44.v2.decrypt(eventWrapper.content, conversationKey);
    } catch (err) {
      console.error("[KeyTeleport] Failed to decrypt content:", err);
      return jsonResponse({ error: "Decryption failed" }, 400);
    }

    // Parse the decrypted payload
    let payload: KeyTeleportPayload;
    try {
      payload = JSON.parse(decryptedContent);
    } catch {
      return jsonResponse({ error: "Invalid payload format" }, 400);
    }

    // Validate required fields
    if (!payload.apiRoute || !payload.hash_id || !payload.timestamp) {
      return jsonResponse({ error: "Missing required fields in payload" }, 400);
    }

    // Check timestamp - the timestamp indicates when the key expires on the key manager
    // We should only proceed if the key hasn't expired yet
    const now = Math.floor(Date.now() / 1000);
    if (payload.timestamp < now) {
      return jsonResponse({ error: "Key teleport link has expired" }, 410);
    }

    // Fetch the ncryptsec from the key manager
    const keyManagerUrl = `${payload.apiRoute}?id=${encodeURIComponent(payload.hash_id)}`;

    console.log(`[KeyTeleport] Fetching key from: ${keyManagerUrl}`);

    let keyManagerRes: Response;
    try {
      keyManagerRes = await fetch(keyManagerUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });
    } catch (err) {
      console.error("[KeyTeleport] Failed to fetch from key manager:", err);
      return jsonResponse({ error: "Failed to reach key manager" }, 502);
    }

    if (!keyManagerRes.ok) {
      console.error(`[KeyTeleport] Key manager returned ${keyManagerRes.status}`);
      return jsonResponse({ error: "Key manager request failed" }, 502);
    }

    let keyData: KeyManagerResponse;
    try {
      keyData = await keyManagerRes.json();
    } catch {
      return jsonResponse({ error: "Invalid response from key manager" }, 502);
    }

    if (!keyData.ncryptsec) {
      return jsonResponse({ error: "Key not found" }, 404);
    }

    // Validate ncryptsec format
    if (!keyData.ncryptsec.startsWith("ncryptsec1")) {
      return jsonResponse({ error: "Invalid key format from key manager" }, 502);
    }

    console.log("[KeyTeleport] Successfully retrieved ncryptsec");

    // Return the ncryptsec to the client
    return jsonResponse({ ncryptsec: keyData.ncryptsec });

  } catch (err) {
    console.error("[KeyTeleport] Unexpected error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
}
