import { nip19 } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";

import { LOGIN_EVENT_KIND } from "../config";
import { jsonResponse, safeJson } from "../http";
import { getUserTeams } from "../master-db";
import { parseSessionCookie } from "../services/auth";
import { validateLoginMethod } from "../validation";

import type { AuthService } from "../services/auth";
import type { Session } from "../types";

type LoginRequestBody = {
  method?: Session["method"];
  event?: {
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  };
};

/** Max age for NIP-98 events (60 seconds) */
const NIP98_MAX_AGE_SECONDS = 60;

/**
 * Enriches a session with team membership data
 */
function enrichSessionWithTeams(session: Session): void {
  const teams = getUserTeams(session.npub);
  session.teamMemberships = teams;

  // Auto-select team if user has exactly one
  if (teams.length === 1) {
    session.currentTeamId = teams[0].teamId;
    session.currentTeamSlug = teams[0].teamSlug;
  }
}

/**
 * Parse and validate a NIP-98 Authorization header.
 * Returns a transient Session if valid, null otherwise.
 *
 * NIP-98 spec: Authorization: Nostr <base64-encoded kind 27235 event>
 * Required tags: u (request URL), method (HTTP method)
 * Validates: kind, signature, URL pathname match, method match, timestamp freshness
 */
function sessionFromNip98(req: Request): Session | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  // Must start with "Nostr "
  if (!authHeader.startsWith("Nostr ")) return null;
  const encoded = authHeader.slice(6).trim();
  if (!encoded) return null;

  // Decode base64 event
  let event: {
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  };

  try {
    const json = atob(encoded);
    event = JSON.parse(json);
  } catch {
    console.warn("[NIP-98] Failed to decode Authorization header");
    return null;
  }

  // Validate kind
  if (event.kind !== LOGIN_EVENT_KIND) {
    console.warn("[NIP-98] Wrong event kind:", event.kind);
    return null;
  }

  // Verify signature
  if (!verifyEvent(event as Parameters<typeof verifyEvent>[0])) {
    console.warn("[NIP-98] Invalid event signature");
    return null;
  }

  // Check timestamp freshness
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > NIP98_MAX_AGE_SECONDS) {
    console.warn("[NIP-98] Event expired, age:", Math.abs(now - event.created_at), "seconds");
    return null;
  }

  // Validate method tag matches request method
  const methodTag = event.tags.find((t) => t[0] === "method");
  if (!methodTag || methodTag[1]?.toUpperCase() !== req.method.toUpperCase()) {
    console.warn("[NIP-98] Method mismatch:", methodTag?.[1], "vs", req.method);
    return null;
  }

  // Validate u tag matches request URL pathname
  // Compare pathnames only (not host) to work behind reverse proxies
  const uTag = event.tags.find((t) => t[0] === "u");
  if (!uTag || !uTag[1]) {
    console.warn("[NIP-98] Missing u tag");
    return null;
  }

  try {
    const eventUrl = new URL(uTag[1]);
    const reqUrl = new URL(req.url);
    if (eventUrl.pathname !== reqUrl.pathname) {
      console.warn("[NIP-98] URL pathname mismatch:", eventUrl.pathname, "vs", reqUrl.pathname);
      return null;
    }
  } catch {
    console.warn("[NIP-98] Invalid URL in u tag:", uTag[1]);
    return null;
  }

  // Build transient session (not persisted to DB)
  const npub = nip19.npubEncode(event.pubkey);
  const session: Session = {
    token: `nip98-${event.id}`,
    pubkey: event.pubkey,
    npub,
    method: "nip98",
    createdAt: Date.now(),
  };

  // Enrich with team memberships
  enrichSessionWithTeams(session);

  console.log(`[NIP-98] Authenticated: ${npub.slice(0, 16)}... ${req.method} ${new URL(req.url).pathname}`);
  return session;
}

export function createAuthHandlers(authService: AuthService, cookieName: string) {
  const login = async (req: Request) => {
    const body = (await safeJson(req)) as LoginRequestBody | null;
    if (!body?.method || !body.event || !validateLoginMethod(body.method)) {
      return jsonResponse({ message: "Invalid payload." }, 400);
    }
    return authService.login(body.method, body.event, enrichSessionWithTeams);
  };

  const logout = (req: Request) => {
    const token = parseSessionCookie(req, cookieName);
    return authService.logout(token);
  };

  const sessionFromRequest = (req: Request): Session | null => {
    // Try cookie-based session first (existing browser sessions)
    const token = parseSessionCookie(req, cookieName);
    const cookieSession = authService.getSession(token);
    if (cookieSession) return cookieSession;

    // Fall back to NIP-98 Authorization header (API access)
    return sessionFromNip98(req);
  };

  return { login, logout, sessionFromRequest };
}
