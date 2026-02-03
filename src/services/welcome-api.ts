/**
 * Welcome API Service
 *
 * Client for Welcome's external API, using NIP-98 authentication.
 * Uses KEYTELEPORT_PRIVKEY to sign requests (same key registered as teleport_pubkey in Welcome).
 */

import { finalizeEvent } from "nostr-tools";

import { getKeyTeleportIdentity, WELCOME_API_URL } from "../config";

/**
 * Create a NIP-98 Authorization header for Welcome API requests
 */
function createNip98AuthHeader(url: string, method: string): string | null {
  const identity = getKeyTeleportIdentity();
  if (!identity) {
    console.error("[Welcome API] No identity configured (KEYTELEPORT_PRIVKEY required)");
    return null;
  }

  // Create NIP-98 auth event (kind 27235)
  const authEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method],
      ],
      content: "",
    },
    identity.secretKey
  );

  // Base64 encode the signed event
  return "Nostr " + btoa(JSON.stringify(authEvent));
}

export interface WelcomeGroup {
  id: number;
  name: string;
  assigned_at: string;
}

export interface WelcomeGroupsResponse {
  success: boolean;
  npub?: string;
  groups?: WelcomeGroup[];
  error?: string;
}

export interface WelcomeInviteCodeResponse {
  success: boolean;
  npub?: string;
  invite_code?: string;
  welcome_message?: string;
  app_id?: number;
  error?: string;
}

/**
 * Parse a welcome message for invite code patterns.
 * Supports formats like:
 *   Invite: Marginal Gains ABC-123-XYZ
 *   MG Code: ABC-123-XYZ
 *   Marginal Gains: ABC-123-XYZ
 */
function parseInviteCodeFromMessage(message: string): string | null {
  if (!message) return null;

  // Pattern 1: "Invite: Marginal Gains CODE" or "Invite: MG CODE"
  const inviteMatch = message.match(/Invite:\s*(?:Marginal\s*Gains|MG)\s+([A-Z0-9-]+)/i);
  if (inviteMatch) return inviteMatch[1];

  // Pattern 2: "MG Code: CODE" or "MG: CODE"
  const mgMatch = message.match(/MG(?:\s*Code)?:\s*([A-Z0-9-]+)/i);
  if (mgMatch) return mgMatch[1];

  // Pattern 3: "Marginal Gains: CODE" or "Marginal Gains Code: CODE"
  const fullMatch = message.match(/Marginal\s*Gains(?:\s*Code)?:\s*([A-Z0-9-]+)/i);
  if (fullMatch) return fullMatch[1];

  return null;
}

/**
 * Get user's groups from Welcome
 *
 * @param npub - User's npub to look up
 * @returns Groups response from Welcome API
 */
export async function getUserGroups(npub: string): Promise<WelcomeGroupsResponse> {
  const url = `${WELCOME_API_URL}/api/user/groups?npub=${encodeURIComponent(npub)}`;

  const authHeader = createNip98AuthHeader(url, "GET");
  if (!authHeader) {
    return { success: false, error: "Welcome API not configured" };
  }

  try {
    console.log(`[Welcome API] Fetching groups for ${npub.slice(0, 20)}...`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": authHeader,
        "Accept": "application/json",
      },
    });

    const data = await response.json() as WelcomeGroupsResponse;

    if (!response.ok) {
      console.error(`[Welcome API] Groups request failed: ${data.error || response.status}`);
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    console.log(`[Welcome API] Found ${data.groups?.length ?? 0} groups for user`);
    return data;
  } catch (err) {
    console.error("[Welcome API] Failed to fetch groups:", err);
    return { success: false, error: "Failed to reach Welcome API" };
  }
}

/**
 * Get linked app invite code for user from Welcome
 *
 * This looks up any MG invite code that was stored against the user's
 * Welcome invite code when they signed up.
 *
 * @param npub - User's npub to look up
 * @param appId - App ID in Welcome (optional, defaults to MG's app ID)
 * @returns Invite code response from Welcome API
 */
export async function getUserInviteCode(npub: string, appId?: number): Promise<WelcomeInviteCodeResponse> {
  let url = `${WELCOME_API_URL}/api/user/app-invite?npub=${encodeURIComponent(npub)}`;
  if (appId) {
    url += `&app_id=${appId}`;
  }

  const authHeader = createNip98AuthHeader(url, "GET");
  if (!authHeader) {
    return { success: false, error: "Welcome API not configured" };
  }

  try {
    console.log(`[Welcome API] Fetching invite code for ${npub.slice(0, 20)}...`);
    console.log(`[Welcome API] URL: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": authHeader,
        "Accept": "application/json",
      },
    });

    // Check if response is JSON before parsing
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      console.error(`[Welcome API] Non-JSON response (${response.status}): ${text.slice(0, 100)}`);
      // If it's a 404, treat as "no invite code" rather than error
      if (response.status === 404) {
        return { success: true, npub, invite_code: undefined };
      }
      return { success: false, error: `Welcome API returned non-JSON: ${response.status}` };
    }

    const data = await response.json() as WelcomeInviteCodeResponse;

    if (!response.ok) {
      // 404 is expected if no invite code is linked
      if (response.status === 404) {
        console.log(`[Welcome API] No invite code found for user`);
        return { success: true, npub, invite_code: undefined };
      }
      console.error(`[Welcome API] Invite code request failed: ${data.error || response.status}`);
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    if (data.invite_code) {
      console.log(`[Welcome API] Found invite code for user: ${data.invite_code.slice(0, 10)}...`);
      return data;
    }

    // Fallback: try to parse invite code from welcome message
    if (data.welcome_message) {
      const parsedCode = parseInviteCodeFromMessage(data.welcome_message);
      if (parsedCode) {
        console.log(`[Welcome API] Parsed invite code from welcome message: ${parsedCode.slice(0, 10)}...`);
        return { ...data, invite_code: parsedCode };
      }
      console.log(`[Welcome API] Welcome message present but no MG invite code pattern found`);
    } else {
      console.log(`[Welcome API] No invite code linked for user`);
    }

    return data;
  } catch (err) {
    console.error("[Welcome API] Failed to fetch invite code:", err);
    return { success: false, error: "Failed to reach Welcome API" };
  }
}
