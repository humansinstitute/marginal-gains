/**
 * Database Router for Multi-Tenant Architecture
 *
 * Manages connections to:
 * - Master database: team registry, memberships, global user directory
 * - Team databases: isolated per-team data (channels, messages, todos, etc.)
 */

import { existsSync, mkdirSync } from "fs";

import { Database } from "bun:sqlite";

import { initTeamSchema } from "./team-schema";

// ============================================================================
// Types
// ============================================================================

export type Team = {
  id: number;
  slug: string;
  display_name: string;
  description: string;
  icon_url: string | null;
  created_at: string;
  created_by: string;
  is_active: number;
  hide_tasks: number;
  hide_crm: number;
};

export type TeamMembership = {
  id: number;
  team_id: number;
  user_npub: string;
  role: "owner" | "manager" | "member";
  invited_by: string | null;
  joined_at: string;
};

export type TeamMembershipWithTeam = TeamMembership & {
  team_slug: string;
  team_display_name: string;
  team_icon_url: string | null;
};

export type GlobalUser = {
  npub: string;
  pubkey: string;
  display_name: string | null;
  picture: string | null;
  created_at: string;
};

export type TeamInvitation = {
  id: number;
  team_id: number;
  code_hash: string;
  role: "owner" | "manager" | "member";
  single_use: number;
  expires_at: number;
  created_by: string;
  redeemed_count: number;
  created_at: number;
  // Zero-knowledge encryption fields
  encrypted_team_key: string | null;
  creator_pubkey: string | null;
  // Optional label for identifying invites
  label: string | null;
};

export type InviteGroup = {
  id: number;
  invitation_id: number;
  group_id: number;
  created_at: number;
};

// ============================================================================
// Configuration
// ============================================================================

const MASTER_DB_PATH = process.env.MASTER_DB_PATH || "data/master.sqlite";
const TEAMS_DB_DIR = process.env.TEAMS_DB_DIR || "data/teams";
const MAX_CACHED_CONNECTIONS = 10;

// ============================================================================
// Master Database
// ============================================================================

let masterDb: Database | null = null;

/**
 * Helper function to add columns safely (ignores "duplicate column" errors)
 */
function addColumn(db: Database, sql: string): void {
  try {
    db.run(sql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column")) {
      throw error;
    }
  }
}

/**
 * Initialize the master database schema
 */
function initMasterSchema(db: Database): void {
  db.run("PRAGMA foreign_keys = ON");

  // Teams registry
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug)");

  // Feature visibility toggles (allow team admins to hide features)
  addColumn(db, "ALTER TABLE teams ADD COLUMN hide_tasks INTEGER DEFAULT 0");
  addColumn(db, "ALTER TABLE teams ADD COLUMN hide_crm INTEGER DEFAULT 0");

  // Team memberships
  db.run(`
    CREATE TABLE IF NOT EXISTS team_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_npub TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by TEXT,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, user_npub)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_team_memberships_user ON team_memberships(user_npub)");
  db.run("CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id)");

  // Global user directory (minimal - full profile lives in team DBs)
  db.run(`
    CREATE TABLE IF NOT EXISTS users_global (
      npub TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      display_name TEXT,
      picture TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Team invitations
  db.run(`
    CREATE TABLE IF NOT EXISTS team_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      single_use INTEGER DEFAULT 1,
      expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      redeemed_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_team_invitations_expires ON team_invitations(expires_at)");

  // Add columns for zero-knowledge team encryption
  // encrypted_team_key: NIP-44 encrypted team key, wrapped for the invite-derived pubkey
  // creator_pubkey: Public key of the invite creator (needed for decryption)
  addColumn(db, "ALTER TABLE team_invitations ADD COLUMN encrypted_team_key TEXT DEFAULT NULL");
  addColumn(db, "ALTER TABLE team_invitations ADD COLUMN creator_pubkey TEXT DEFAULT NULL");

  // Add label column for naming invite codes (e.g., "Workshop on 5th")
  addColumn(db, "ALTER TABLE team_invitations ADD COLUMN label TEXT DEFAULT NULL");

  // Invite groups - associates groups with invites for auto-joining
  // When a user redeems an invite, they are added to these groups (which gives channel access)
  db.run(`
    CREATE TABLE IF NOT EXISTS invite_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invitation_id INTEGER NOT NULL REFERENCES team_invitations(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(invitation_id, group_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_invite_groups_invitation ON invite_groups(invitation_id)");
}

/**
 * Ensure directories exist for database files
 */
function ensureDirectories(): void {
  const masterDir = MASTER_DB_PATH.substring(0, MASTER_DB_PATH.lastIndexOf("/"));
  if (masterDir && !existsSync(masterDir)) {
    mkdirSync(masterDir, { recursive: true });
  }
  if (!existsSync(TEAMS_DB_DIR)) {
    mkdirSync(TEAMS_DB_DIR, { recursive: true });
  }
}

/**
 * Get the master database connection (singleton)
 */
export function getMasterDb(): Database {
  if (!masterDb) {
    ensureDirectories();
    masterDb = new Database(MASTER_DB_PATH);
    initMasterSchema(masterDb);
  }
  return masterDb;
}

/**
 * Close the master database connection
 */
export function closeMasterDb(): void {
  if (masterDb) {
    masterDb.close();
    masterDb = null;
  }
}

// ============================================================================
// Team Database Connection Cache
// ============================================================================

type CachedConnection = {
  db: Database;
  lastAccess: number;
};

const teamDbCache = new Map<string, CachedConnection>();

/**
 * Get the file path for a team database
 */
export function getTeamDbPath(teamSlug: string): string {
  return `${TEAMS_DB_DIR}/${teamSlug}.sqlite`;
}

/**
 * Check if a team database exists
 */
export function teamDbExists(teamSlug: string): boolean {
  return existsSync(getTeamDbPath(teamSlug));
}

/**
 * Get a team database connection (cached with LRU eviction)
 */
export function getTeamDb(teamSlug: string): Database {
  // Check cache
  const cached = teamDbCache.get(teamSlug);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached.db;
  }

  // Evict oldest if at capacity
  if (teamDbCache.size >= MAX_CACHED_CONNECTIONS) {
    let oldestSlug: string | null = null;
    let oldestTime = Infinity;
    for (const [slug, conn] of teamDbCache.entries()) {
      if (conn.lastAccess < oldestTime) {
        oldestTime = conn.lastAccess;
        oldestSlug = slug;
      }
    }
    if (oldestSlug) {
      const evicted = teamDbCache.get(oldestSlug);
      if (evicted) {
        evicted.db.close();
      }
      teamDbCache.delete(oldestSlug);
    }
  }

  // Open new connection
  ensureDirectories();
  const path = getTeamDbPath(teamSlug);
  const db = new Database(path);

  // Initialize team schema (safe to call on existing databases)
  initTeamSchema(db);

  teamDbCache.set(teamSlug, { db, lastAccess: Date.now() });
  return db;
}

/**
 * Close a specific team database connection
 */
export function closeTeamDb(teamSlug: string): void {
  const cached = teamDbCache.get(teamSlug);
  if (cached) {
    cached.db.close();
    teamDbCache.delete(teamSlug);
  }
}

/**
 * Close all team database connections
 */
export function closeAllTeamDbs(): void {
  for (const { db } of teamDbCache.values()) {
    db.close();
  }
  teamDbCache.clear();
}

/**
 * Close all database connections (master + all teams)
 */
export function closeAllDbs(): void {
  closeMasterDb();
  closeAllTeamDbs();
}

// ============================================================================
// Helper: Get connection count (for monitoring/debugging)
// ============================================================================

export function getConnectionStats(): { master: boolean; teams: string[] } {
  return {
    master: masterDb !== null,
    teams: Array.from(teamDbCache.keys()),
  };
}
