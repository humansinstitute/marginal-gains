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
    const token = parseSessionCookie(req, cookieName);
    return authService.getSession(token);
  };

  return { login, logout, sessionFromRequest };
}
