#!/usr/bin/env bun
/**
 * Key Distribution Daemon
 *
 * An always-on CLI tool that automatically distributes encryption keys
 * to new team members who join via invite codes.
 *
 * Usage:
 *   SECRET_KEY=<encryption-key> SERVER_URL=<url> TEAM_SLUG=<slug> bun cli/key-daemon.ts
 *
 * The daemon will:
 *   1. Prompt for your nsec (stored encrypted in memory)
 *   2. Authenticate to the server
 *   3. Poll for pending key requests
 *   4. Automatically fulfill them by wrapping channel keys
 */

import * as readline from "readline";

import { nip19, nip44, finalizeEvent, getPublicKey } from "nostr-tools";

import type { UnsignedEvent } from "nostr-tools";

// ============================================================================
// Configuration
// ============================================================================

const ENV_SECRET = process.env.SECRET_KEY;
const SERVER_URL = process.env.SERVER_URL?.replace(/\/$/, ""); // Remove trailing slash
const TEAM_SLUG = process.env.TEAM_SLUG;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "30000", 10); // Default 30 seconds

if (!ENV_SECRET) {
  console.error("❌ SECRET_KEY environment variable is required");
  process.exit(1);
}
if (!SERVER_URL) {
  console.error("❌ SERVER_URL environment variable is required");
  process.exit(1);
}
if (!TEAM_SLUG) {
  console.error("❌ TEAM_SLUG environment variable is required");
  process.exit(1);
}

// ============================================================================
// Simple XOR encryption for nsec at rest (not for production security!)
// In a real deployment, use proper encryption like AES-GCM
// ============================================================================

function xorEncrypt(plaintext: string, key: string): string {
  const result: number[] = [];
  for (let i = 0; i < plaintext.length; i++) {
    result.push(plaintext.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(result).toString("base64");
}

function _xorDecrypt(ciphertext: string, key: string): string {
  const bytes = Buffer.from(ciphertext, "base64");
  const result: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    result.push(String.fromCharCode(bytes[i] ^ key.charCodeAt(i % key.length)));
  }
  return result.join("");
}

// ============================================================================
// NIP-44 Key Wrapping
// ============================================================================

function wrapKeyForUser(
  channelKeyBase64: string,
  recipientPubkeyHex: string,
  senderSecretKey: Uint8Array
): string {
  const senderPubkey = getPublicKey(senderSecretKey);
  const conversationKey = nip44.v2.utils.getConversationKey(senderSecretKey, recipientPubkeyHex);
  const ciphertext = nip44.v2.encrypt(channelKeyBase64, conversationKey);

  return JSON.stringify({
    v: 1,
    alg: "nip44",
    key: ciphertext,
    created_by: senderPubkey,
    created_at: new Date().toISOString(),
  });
}

function unwrapKey(wrappedKeyJson: string, secretKey: Uint8Array): string {
  const wrapped = JSON.parse(wrappedKeyJson);
  if (wrapped.v !== 1 || wrapped.alg !== "nip44") {
    throw new Error(`Unsupported key format: v${wrapped.v} alg=${wrapped.alg}`);
  }

  const senderPubkey = wrapped.created_by;
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, senderPubkey);
  return nip44.v2.decrypt(wrapped.key, conversationKey);
}

// ============================================================================
// State
// ============================================================================

let _encryptedNsec: string | null = null; // Stored for potential session recovery
let sessionToken: string | null = null;
let secretKey: Uint8Array | null = null;
let isReconnecting = false;
let lastReconnectAttempt = 0;
const RECONNECT_COOLDOWN = 30000; // 30 seconds between reconnect attempts

// ============================================================================
// Authentication
// ============================================================================

async function login(nsec: string): Promise<boolean> {
  try {

    // Decode nsec
    const decoded = nip19.decode(nsec);
    if (decoded.type !== "nsec") {
      console.error("❌ Invalid nsec format, got type:", decoded.type);
      return false;
    }

    secretKey = decoded.data as Uint8Array;
    console.log(`   secret key length: ${secretKey.length} bytes`);

    const pubkey = getPublicKey(secretKey);
    const npub = nip19.npubEncode(pubkey);
    console.log(`   derived pubkey (hex): ${pubkey}`);
    console.log(`   derived npub: ${npub}`);

    // Encrypt nsec for storage in memory (for potential session recovery)
    _encryptedNsec = xorEncrypt(nsec, ENV_SECRET!);

    // Create login event (kind 27235 - NIP-98 style)
    const unsignedEvent: UnsignedEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["app", "marginal-gains"],
        ["method", "ephemeral"],
      ],
      content: "",
      pubkey,
    };

    const signedEvent = finalizeEvent(unsignedEvent, secretKey);

    // POST to login endpoint
    const res = await fetch(`${SERVER_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "ephemeral", event: signedEvent }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error("❌ Login failed:", error);
      return false;
    }

    // Extract session token from Set-Cookie header
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/session=([^;]+)/);
      if (match) {
        sessionToken = match[1];
      }
    }

    if (!sessionToken) {
      // Try to get from response body
      const body = await res.json();
      sessionToken = body.token;
    }

    if (!sessionToken) {
      console.error("❌ No session token received");
      return false;
    }

    console.log("✅ Authenticated as", npub);
    console.log(`   Token: ${sessionToken.slice(0, 8)}...${sessionToken.slice(-4)}`);
    return true;
  } catch (err) {
    console.error("❌ Login error:", err);
    return false;
  }
}

// ============================================================================
// Session Recovery
// ============================================================================

async function reconnect(): Promise<boolean> {
  if (!secretKey) {
    console.error("❌ Cannot reconnect - no secret key in memory");
    return false;
  }

  // Prevent concurrent reconnection attempts
  if (isReconnecting) {
    return false;
  }

  // Enforce cooldown between attempts
  const now = Date.now();
  if (now - lastReconnectAttempt < RECONNECT_COOLDOWN) {
    const waitSecs = Math.ceil((RECONNECT_COOLDOWN - (now - lastReconnectAttempt)) / 1000);
    console.log(`   (waiting ${waitSecs}s before retry)`);
    return false;
  }

  isReconnecting = true;
  lastReconnectAttempt = now;

  try {
    const pubkey = getPublicKey(secretKey);
    const npub = nip19.npubEncode(pubkey);

    // Create login event (kind 27235 - NIP-98 style)
    const unsignedEvent: UnsignedEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["app", "marginal-gains"],
        ["method", "ephemeral"],
      ],
      content: "",
      pubkey,
    };

    const signedEvent = finalizeEvent(unsignedEvent, secretKey);

    // POST to login endpoint
    const res = await fetch(`${SERVER_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "ephemeral", event: signedEvent }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error("❌ Reconnect failed:", error);
      isReconnecting = false;
      return false;
    }

    // Extract session token from Set-Cookie header
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/session=([^;]+)/);
      if (match) {
        sessionToken = match[1];
      }
    }

    if (!sessionToken) {
      // Try to get from response body
      const body = await res.json();
      sessionToken = body.token;
    }

    if (!sessionToken) {
      console.error("❌ Reconnect: No session token received");
      isReconnecting = false;
      return false;
    }

    console.log("✅ Reconnected as", npub);
    isReconnecting = false;
    return true;
  } catch (err) {
    console.error("❌ Reconnect error:", err);
    isReconnecting = false;
    return false;
  }
}

// ============================================================================
// Key Distribution
// ============================================================================

interface KeyRequest {
  id: number;
  channel_id: number;
  channel_name: string;
  requester_npub: string;
  requester_pubkey: string;
  requester_display_name: string;
  status: string;
}

async function fetchPendingRequests(): Promise<KeyRequest[]> {
  const url = `${SERVER_URL}/t/${TEAM_SLUG}/api/key-requests/pending`;
  const res = await fetch(url, {
    headers: { Cookie: `nostr_session=${sessionToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.log(`⚠️  Request failed: ${res.status} ${res.statusText}`);
    console.log(`   URL: ${url}`);
    console.log(`   Token: ${sessionToken?.slice(0, 8)}...${sessionToken?.slice(-4)}`);
    console.log(`   Response: ${body.slice(0, 200)}`);
    if (res.status === 401) {
      sessionToken = null;
    }
    return [];
  }

  const data = await res.json();
  return data.requests || [];
}

async function fetchChannelKey(channelId: number): Promise<string | null> {
  const res = await fetch(`${SERVER_URL}/t/${TEAM_SLUG}/chat/channels/${channelId}/keys`, {
    headers: { Cookie: `nostr_session=${sessionToken}` },
  });

  if (!res.ok) {
    if (res.status === 401) {
      console.log("  ⚠️  Session expired during key fetch");
      sessionToken = null;
    } else {
      console.error(`  ⚠️  No key found for channel ${channelId}`);
    }
    return null;
  }

  const data = await res.json();
  return data.encrypted_key || null;
}

async function fulfillRequest(request: KeyRequest): Promise<boolean> {
  if (!secretKey) {
    console.error("  ❌ No secret key available");
    return false;
  }

  try {
    // Fetch our wrapped channel key
    const wrappedKey = await fetchChannelKey(request.channel_id);
    if (!wrappedKey) {
      return false;
    }

    // Unwrap it using our secret key
    const channelKey = unwrapKey(wrappedKey, secretKey);

    // Wrap it for the requester
    const rewrappedKey = wrapKeyForUser(channelKey, request.requester_pubkey, secretKey);

    // Submit fulfillment
    const res = await fetch(`${SERVER_URL}/t/${TEAM_SLUG}/api/key-requests/${request.id}/fulfill`, {
      method: "POST",
      headers: {
        Cookie: `nostr_session=${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ encryptedKey: rewrappedKey }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error(`  ❌ Fulfill failed: ${error}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`  ❌ Error:`, err instanceof Error ? err.message : err);
    return false;
  }
}

async function pollAndFulfill(): Promise<void> {
  if (!sessionToken) {
    console.log(`[${timestamp()}] ⚠️  Not authenticated, attempting reconnect...`);
    const reconnected = await reconnect();
    if (!reconnected) {
      return; // Will retry on next poll cycle
    }
  }

  try {
    const requests = await fetchPendingRequests();

    if (requests.length === 0) {
      console.log(`[${timestamp()}] No pending requests`);
      return;
    }

    console.log(`[${timestamp()}] Found ${requests.length} pending request(s)`);

    for (const req of requests) {
      const displayName = req.requester_display_name || req.requester_npub.slice(0, 12) + "...";
      console.log(`  → ${displayName} needs key for #${req.channel_name}`);

      const success = await fulfillRequest(req);
      if (success) {
        console.log(`  ✅ Distributed key to ${displayName}`);
      }
    }
  } catch (err) {
    console.error(`[${timestamp()}] Poll error:`, err instanceof Error ? err.message : err);
  }
}

// ============================================================================
// Utilities
// ============================================================================

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function clearLine(): void {
  process.stdout.write("\x1B[1A\x1B[2K");
}

// ============================================================================
// Main
// ============================================================================

function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  console.log("");
  console.log("🔐 Key Distribution Daemon");
  console.log("══════════════════════════════════════════════════");
  console.log(`   Server: ${SERVER_URL}`);
  console.log(`   Team:   ${TEAM_SLUG}`);
  console.log(`   Poll:   Every ${POLL_INTERVAL / 1000}s`);
  console.log("");

  const nsec = await askQuestion("Paste your nsec: ");

  // Clear the secret from terminal
  clearLine();
  console.log("Paste your nsec: ********");

  const trimmed = nsec.trim();
  if (!trimmed.startsWith("nsec1")) {
    console.error("❌ Invalid format. Must start with 'nsec1'");
    process.exit(1);
  }

  const loggedIn = await login(trimmed);
  if (!loggedIn) {
    process.exit(1);
  }

  console.log("");
  console.log("🔄 Starting poll loop...");
  console.log("   Press Ctrl+C to stop");
  console.log("");

  // Initial poll
  await pollAndFulfill();

  // Poll loop - wrap in void to indicate we're intentionally not awaiting
  setInterval(() => {
    void pollAndFulfill();
  }, POLL_INTERVAL);
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...");
  process.exit(0);
});

void main();
