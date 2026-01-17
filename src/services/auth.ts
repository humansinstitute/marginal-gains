import { nip19 } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";

import {
  saveSession as dbSaveSession,
  getSession as dbGetSession,
  deleteSession as dbDeleteSession,
  cleanupExpiredSessions,
} from "../db";
import { jsonResponse, serializeSessionCookie } from "../http";

import type { LoginMethod, Session, SessionTeamMembership } from "../types";

type LoginEvent = {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
};

type ValidateResult = { ok: true } | { ok: false; message: string };

export class AuthService {
  constructor(
    private readonly sessionCookieName: string,
    private readonly appTag: string,
    private readonly loginKind: number,
    private readonly loginMaxAgeSeconds: number,
    private readonly cookieSecure: boolean,
    private readonly sessionMaxAgeSeconds: number
  ) {
    // Cleanup expired sessions on startup
    cleanupExpiredSessions();
  }

  getSession(token: string | null): Session | null {
    if (!token) return null;
    const dbSession = dbGetSession(token);
    if (!dbSession) return null;

    // Convert db row to Session type
    let teamMemberships: SessionTeamMembership[] | undefined;
    if (dbSession.team_memberships) {
      try {
        teamMemberships = JSON.parse(dbSession.team_memberships);
      } catch {
        teamMemberships = undefined;
      }
    }

    return {
      token: dbSession.token,
      pubkey: dbSession.pubkey,
      npub: dbSession.npub,
      method: dbSession.method as LoginMethod,
      createdAt: dbSession.created_at,
      currentTeamId: dbSession.current_team_id,
      currentTeamSlug: dbSession.current_team_slug,
      teamMemberships,
    };
  }

  destroySession(token: string | null) {
    if (!token) return;
    dbDeleteSession(token);
  }

  validateLoginEvent(method: LoginMethod, event: LoginEvent): ValidateResult {
    if (!event) return { ok: false, message: "Missing event." };
    if (event.kind !== this.loginKind) return { ok: false, message: "Unexpected event kind." };
    if (!verifyEvent(event as any)) return { ok: false, message: "Invalid event signature." };
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > this.loginMaxAgeSeconds) {
      return { ok: false, message: "Login event expired." };
    }
    const hasAppTag = event.tags.some((tag) => tag[0] === "app" && tag[1] === this.appTag);
    if (!hasAppTag) return { ok: false, message: "Missing app tag." };
    const hasMethodTag = event.tags.some((tag) => tag[0] === "method" && tag[1] === method);
    if (!hasMethodTag) return { ok: false, message: "Method mismatch." };
    return { ok: true };
  }

  createSession(method: LoginMethod, event: LoginEvent) {
    const token = crypto.randomUUID();
    const createdAt = Date.now();
    const session: Session = {
      token,
      pubkey: event.pubkey,
      npub: nip19.npubEncode(event.pubkey),
      method,
      createdAt,
    };
    return {
      session,
      cookie: serializeSessionCookie(token, this.sessionCookieName, this.sessionMaxAgeSeconds, this.cookieSecure),
    };
  }

  private persistSession(session: Session) {
    const expiresAt = session.createdAt + this.sessionMaxAgeSeconds * 1000;
    const teamMemberships = session.teamMemberships ? JSON.stringify(session.teamMemberships) : null;
    dbSaveSession(
      session.token,
      session.pubkey,
      session.npub,
      session.method,
      session.createdAt,
      expiresAt,
      session.currentTeamId ?? null,
      session.currentTeamSlug ?? null,
      teamMemberships
    );
  }

  login(method: LoginMethod, event: LoginEvent, enrichSession?: (session: Session) => void) {
    const validation = this.validateLoginEvent(method, event);
    if (!validation.ok) return jsonResponse({ message: validation.message }, 422);
    const { session, cookie } = this.createSession(method, event);

    // Allow caller to enrich session with additional data (e.g., team memberships)
    if (enrichSession) {
      enrichSession(session);
    }

    // Persist session to database after enrichment
    this.persistSession(session);

    return jsonResponse(session, 200, cookie);
  }

  logout(token: string | null) {
    if (token) {
      dbDeleteSession(token);
    }
    const cleared = serializeSessionCookie(null, this.sessionCookieName, this.sessionMaxAgeSeconds, this.cookieSecure);
    return jsonResponse({ ok: true }, 200, cleared);
  }
}

export function parseSessionCookie(req: Request, cookieName: string) {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(";").map((pair) => pair.trim());
  for (const pair of pairs) {
    const [key, ...rest] = pair.split("=");
    if (key === cookieName) return decodeURIComponent(rest.join("="));
  }
  return null;
}
