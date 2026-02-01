/**
 * Key Teleport v2 route handler
 * Handles secure key import from external key manager via NIP-44 encrypted payloads
 *
 * Protocol v2: Self-contained blobs with double encryption
 * - Outer layer: NIP-44 encrypted to this app's pubkey (decrypted server-side)
 * - Inner layer: NIP-44 encrypted with throwaway key (decrypted client-side)
 * - No API callback to key manager - everything is in the blob
 */

import { finalizeEvent, nip44, verifyEvent } from "nostr-tools";

import { getKeyTeleportIdentity } from "../config";
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

// v2 payload structure - self-contained, no API callback
interface KeyTeleportPayloadV2 {
  encryptedNsec: string;  // NIP-44 encrypted nsec (inner layer, user + throwaway)
  npub: string;           // User's public key
  v: number;              // Protocol version (must be 1)
}

/**
 * Handle POST /api/keyteleport
 * v2 Protocol:
 * 1. Decode base64 blob to get signed Nostr event
 * 2. Verify event signature (proves authenticity)
 * 3. Decrypt content with our private key (outer layer)
 * 4. Return encryptedNsec and npub for client-side decryption (inner layer)
 *
 * Note: No recipient tag validation - decryption success proves we're the intended recipient
 */
export async function handleKeyTeleport(req: Request): Promise<Response> {
  // Check if Key Teleport is configured
  const identity = getKeyTeleportIdentity();

  if (!identity) {
    return jsonResponse({ error: "Key Teleport not configured" }, 503);
  }

  // Parse request body
  const body = (await safeJson(req)) as KeyTeleportRequest | null;
  if (!body?.blob) {
    return jsonResponse({ error: "Missing blob parameter" }, 400);
  }

  try {
    // Decode the base64 blob to get the signed event
    let eventJson: string;
    try {
      eventJson = atob(body.blob);
    } catch {
      return jsonResponse({ error: "Invalid blob encoding" }, 400);
    }

    // Parse the event
    let event: { pubkey: string; content: string; sig: string; id: string; kind: number; created_at: number; tags: string[][] };
    try {
      event = JSON.parse(eventJson);
    } catch {
      return jsonResponse({ error: "Invalid event format" }, 400);
    }

    // Verify the event signature (proves the blob wasn't tampered with)
    if (!verifyEvent(event)) {
      return jsonResponse({ error: "Invalid event signature" }, 400);
    }

    // Decrypt the content using NIP-44
    // In v2, we don't verify sender pubkey - decryption success = blob was for us
    const secretKeyHex = bytesToHex(identity.secretKey);
    const conversationKey = nip44.v2.utils.getConversationKey(secretKeyHex, event.pubkey);

    let decryptedContent: string;
    try {
      decryptedContent = nip44.v2.decrypt(event.content, conversationKey);
    } catch {
      console.error("[KeyTeleport] Decryption failed - blob not for this app");
      return jsonResponse({ error: "Decryption failed - wrong recipient?" }, 400);
    }

    // Parse the decrypted payload
    let payload: KeyTeleportPayloadV2;
    try {
      payload = JSON.parse(decryptedContent);
    } catch {
      return jsonResponse({ error: "Invalid payload format" }, 400);
    }

    // Validate protocol version
    if (payload.v !== 1) {
      console.error(`[KeyTeleport] Unsupported protocol version: ${payload.v}`);
      return jsonResponse({ error: `Unsupported protocol version: ${payload.v}` }, 400);
    }

    // Validate required fields
    if (!payload.encryptedNsec || !payload.npub) {
      return jsonResponse({ error: "Missing required fields in payload" }, 400);
    }

    // Validate npub format
    if (!payload.npub.startsWith("npub1")) {
      return jsonResponse({ error: "Invalid npub format" }, 400);
    }

    console.log(`[KeyTeleport] Successfully decrypted blob for ${payload.npub.slice(0, 12)}...`);

    // Return encryptedNsec and npub to client for client-side decryption
    return jsonResponse({
      encryptedNsec: payload.encryptedNsec,
      npub: payload.npub,
    });

  } catch (err) {
    console.error("[KeyTeleport] Unexpected error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
}

/**
 * Handle GET /api/keyteleport/register
 * Generates a registration blob for this app to be pasted into a key manager (Welcome)
 *
 * The blob is a signed Nostr event with plaintext content containing app info
 */
export function handleKeyTeleportRegister(req: Request): Response {
  const identity = getKeyTeleportIdentity();

  if (!identity) {
    return jsonResponse({ error: "Key Teleport not configured" }, 503);
  }

  try {
    // Get the current origin from the request
    // Check forwarded headers first (for reverse proxy setups like Cloudflare)
    const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
    const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");

    let origin: string;
    if (forwardedHost) {
      origin = `${forwardedProto}://${forwardedHost}`;
    } else {
      // Fallback to request URL
      const requestUrl = new URL(req.url);
      origin = requestUrl.origin;
    }

    // App registration info - use current deployment URL
    const content = {
      url: origin,
      name: "Marginal Gains",
      description: "Track your tasks and collaborate with your team",
    };

    // Create and sign the registration event
    const event = finalizeEvent(
      {
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["type", "keyteleport-app-registration"]],
        content: JSON.stringify(content),
      },
      identity.secretKey
    );

    // Base64 encode the signed event
    const blob = btoa(JSON.stringify(event));

    console.log(`[KeyTeleport] Generated registration blob for pubkey ${identity.pubkey.slice(0, 12)}...`);

    return jsonResponse({
      blob,
      npub: identity.npub,
      pubkey: identity.pubkey,
    });

  } catch (err) {
    console.error("[KeyTeleport] Failed to generate registration blob:", err);
    return jsonResponse({ error: "Failed to generate registration" }, 500);
  }
}
