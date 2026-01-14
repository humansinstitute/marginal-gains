/**
 * Request Context for Multi-Tenant Architecture
 *
 * Provides a unified context object for route handlers that includes:
 * - Session information (user identity + current team)
 * - Database connections (master + team-specific)
 */

import { isAdmin } from "./config";
import { getMasterDb, getTeamDb, teamDbExists } from "./db-router";
import { getTeamBySlug, getUserTeams, isUserTeamMember } from "./master-db";

import type { Session } from "./types";
import type { Database } from "bun:sqlite";

// ============================================================================
// Types
// ============================================================================

/**
 * Request context passed to route handlers
 */
export type RequestContext = {
  /** User session (null if not authenticated) */
  session: Session | null;

  /** Master database connection (always available) */
  masterDb: Database;

  /** Team database connection (null if no team selected) */
  teamDb: Database | null;

  /** Current team slug (null if no team selected) */
  teamSlug: string | null;

  /** Current team ID (null if no team selected) */
  teamId: number | null;
};

/**
 * Team context - RequestContext with team guaranteed to be present
 */
export type TeamContext = RequestContext & {
  session: Session;
  teamDb: Database;
  teamSlug: string;
  teamId: number;
};

// ============================================================================
// Context Factory
// ============================================================================

/**
 * Create a request context from a session
 *
 * This is the main entry point for route handlers. It:
 * 1. Gets the master database connection
 * 2. If the session has a current team, gets that team's database connection
 */
export function createContext(session: Session | null): RequestContext {
  const masterDb = getMasterDb();
  let teamDb: Database | null = null;
  let teamSlug: string | null = null;
  let teamId: number | null = null;

  if (session?.currentTeamSlug) {
    teamSlug = session.currentTeamSlug;
    teamId = session.currentTeamId ?? null;
    if (teamDbExists(teamSlug)) {
      teamDb = getTeamDb(teamSlug);
    }
  }

  return { session, masterDb, teamDb, teamSlug, teamId };
}

/**
 * Create a context for a specific team (bypasses session team)
 *
 * Useful for:
 * - Admin operations across teams
 * - Background jobs
 * - Migration scripts
 */
export function createTeamContext(teamSlug: string): RequestContext {
  const masterDb = getMasterDb();
  let teamDb: Database | null = null;
  let teamId: number | null = null;

  const team = getTeamBySlug(teamSlug);
  if (team) {
    teamId = team.id;
  }

  if (teamDbExists(teamSlug)) {
    teamDb = getTeamDb(teamSlug);
  }

  return {
    session: null,
    masterDb,
    teamDb,
    teamSlug,
    teamId,
  };
}

// ============================================================================
// Context Helpers
// ============================================================================

/**
 * Check if context has an authenticated session
 */
export function hasSession(ctx: RequestContext): ctx is RequestContext & { session: Session } {
  return ctx.session !== null;
}

/**
 * Check if context has a team selected
 */
export function hasTeam(
  ctx: RequestContext
): ctx is RequestContext & { teamDb: Database; teamSlug: string } {
  return ctx.teamDb !== null && ctx.teamSlug !== null;
}

/**
 * Check if the current user is a team owner
 */
export function isTeamOwner(ctx: RequestContext): boolean {
  if (!ctx.session || !ctx.session.currentTeamId) return false;
  const membership = ctx.session.teamMemberships.find(
    (m) => m.teamId === ctx.session!.currentTeamId
  );
  return membership?.role === "owner";
}

/**
 * Check if the current user is a team manager (owner or manager role)
 */
export function isTeamManager(ctx: RequestContext): boolean {
  if (!ctx.session || !ctx.session.currentTeamId) return false;
  const membership = ctx.session.teamMemberships.find(
    (m) => m.teamId === ctx.session!.currentTeamId
  );
  return membership?.role === "owner" || membership?.role === "manager";
}

/**
 * Check if the current user is a member of the current team
 */
export function isTeamMember(ctx: RequestContext): boolean {
  if (!ctx.session || !ctx.session.currentTeamId) return false;
  return ctx.session.teamMemberships.some((m) => m.teamId === ctx.session!.currentTeamId);
}

/**
 * Get the user's role in the current team
 */
export function getTeamRole(ctx: RequestContext): "owner" | "manager" | "member" | null {
  if (!ctx.session || !ctx.session.currentTeamId) return null;
  const membership = ctx.session.teamMemberships.find(
    (m) => m.teamId === ctx.session!.currentTeamId
  );
  return membership?.role ?? null;
}

// ============================================================================
// Team Route Context (for /t/{team}/* routes)
// ============================================================================

/**
 * Result of creating a team route context
 */
export type TeamContextResult =
  | { ok: true; ctx: TeamContext }
  | { ok: false; response: Response };

/**
 * Create context for a team-scoped route (/t/{team}/*)
 *
 * Validates:
 * - User is authenticated
 * - Team exists
 * - User has access to team (member or admin)
 *
 * Updates session with team context
 */
export function createTeamRouteContext(
  session: Session | null,
  teamSlug: string
): TeamContextResult {
  // Check authentication
  if (!session) {
    return {
      ok: false,
      response: new Response(null, {
        status: 302,
        headers: { Location: "/auth/login" },
      }),
    };
  }

  // Get team from master database
  const team = getTeamBySlug(teamSlug);
  if (!team) {
    return {
      ok: false,
      response: new Response("Team not found", { status: 404 }),
    };
  }

  // Check team membership (admins can access any team)
  if (!isAdmin(session.npub) && !isUserTeamMember(team.id, session.npub)) {
    return {
      ok: false,
      response: new Response("You are not a member of this team", { status: 403 }),
    };
  }

  // Check team database exists
  if (!teamDbExists(teamSlug)) {
    return {
      ok: false,
      response: new Response("Team database not found", { status: 500 }),
    };
  }

  // Update session with team context
  session.currentTeamId = team.id;
  session.currentTeamSlug = team.slug;
  session.teamMemberships = getUserTeams(session.npub);

  // Create context with team database
  const masterDb = getMasterDb();
  const teamDb = getTeamDb(teamSlug);

  return {
    ok: true,
    ctx: {
      session,
      masterDb,
      teamDb,
      teamSlug,
      teamId: team.id,
    },
  };
}
