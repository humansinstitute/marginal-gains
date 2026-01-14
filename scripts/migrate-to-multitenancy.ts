#!/usr/bin/env bun
/**
 * Migration Script: Single-tenant to Multi-tenant
 *
 * This script migrates an existing Marginal Gains installation to
 * the multi-tenant architecture by:
 *
 * 1. Creating the data directory structure
 * 2. Initializing the master database
 * 3. Copying the existing database as the first team
 * 4. Creating the team record and memberships
 * 5. Promoting admins to team owners
 *
 * Usage:
 *   bun run scripts/migrate-to-multitenancy.ts
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 *   --team-name  Custom team display name (default: "Marginal Gains")
 *   --team-slug  Custom team slug (default: "marginalgains")
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";

import { Database } from "bun:sqlite";

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const teamNameIndex = args.indexOf("--team-name");
const teamSlugIndex = args.indexOf("--team-slug");

const TEAM_DISPLAY_NAME = teamNameIndex >= 0 ? args[teamNameIndex + 1] : "Marginal Gains";
const TEAM_SLUG = teamSlugIndex >= 0 ? args[teamSlugIndex + 1] : "marginalgains";

// Paths
const LEGACY_DB_PATH = process.env.DB_PATH || "marginal-gains.sqlite";
const MASTER_DB_PATH = process.env.MASTER_DB_PATH || "data/master.sqlite";
const TEAMS_DB_DIR = process.env.TEAMS_DB_DIR || "data/teams";
const TEAM_DB_PATH = `${TEAMS_DB_DIR}/${TEAM_SLUG}.sqlite`;

// Admin npubs from environment
const ADMIN_NPUBS = (process.env.ADMIN_NPUBS || process.env.ADMIN_NPUB || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function log(message: string) {
  console.log(`[migrate] ${message}`);
}

function logDry(message: string) {
  if (dryRun) {
    console.log(`[dry-run] Would: ${message}`);
  }
}

function main() {
  log("Starting migration to multi-tenancy...");
  log(`  Legacy DB: ${LEGACY_DB_PATH}`);
  log(`  Master DB: ${MASTER_DB_PATH}`);
  log(`  Team DB: ${TEAM_DB_PATH}`);
  log(`  Team Name: ${TEAM_DISPLAY_NAME}`);
  log(`  Team Slug: ${TEAM_SLUG}`);
  log(`  Admin NPUBs: ${ADMIN_NPUBS.length > 0 ? ADMIN_NPUBS.join(", ") : "(none)"}`);

  if (dryRun) {
    log("DRY RUN MODE - No changes will be made");
  }

  // Step 1: Check if legacy database exists
  if (!existsSync(LEGACY_DB_PATH)) {
    log(`Warning: Legacy database not found at ${LEGACY_DB_PATH}`);
    log("This is OK for fresh installations. Creating empty team database.");
  }

  // Step 2: Check if already migrated
  if (existsSync(MASTER_DB_PATH)) {
    log(`Master database already exists at ${MASTER_DB_PATH}`);
    log("Migration may have already been run. Checking for existing team...");

    const masterDb = new Database(MASTER_DB_PATH);
    const existingTeam = masterDb
      .query<{ id: number }, [string]>("SELECT id FROM teams WHERE slug = ?")
      .get(TEAM_SLUG);

    if (existingTeam) {
      log(`Team '${TEAM_SLUG}' already exists (id: ${existingTeam.id}). Aborting.`);
      masterDb.close();
      process.exit(1);
    }
    masterDb.close();
  }

  // Step 3: Create directories
  log("Creating directory structure...");
  const masterDir = MASTER_DB_PATH.substring(0, MASTER_DB_PATH.lastIndexOf("/"));

  if (!dryRun) {
    if (masterDir && !existsSync(masterDir)) {
      mkdirSync(masterDir, { recursive: true });
      log(`  Created: ${masterDir}`);
    }
    if (!existsSync(TEAMS_DB_DIR)) {
      mkdirSync(TEAMS_DB_DIR, { recursive: true });
      log(`  Created: ${TEAMS_DB_DIR}`);
    }
  } else {
    logDry(`Create directory: ${masterDir}`);
    logDry(`Create directory: ${TEAMS_DB_DIR}`);
  }

  // Step 4: Initialize master database
  log("Initializing master database...");

  let masterDb: Database | null = null;
  if (!dryRun) {
    masterDb = new Database(MASTER_DB_PATH);
    masterDb.run("PRAGMA foreign_keys = ON");

    // Create master schema
    masterDb.run(`
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
    masterDb.run("CREATE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug)");

    masterDb.run(`
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
    masterDb.run("CREATE INDEX IF NOT EXISTS idx_team_memberships_user ON team_memberships(user_npub)");
    masterDb.run("CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id)");

    masterDb.run(`
      CREATE TABLE IF NOT EXISTS users_global (
        npub TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        display_name TEXT,
        picture TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    masterDb.run(`
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
    masterDb.run("CREATE INDEX IF NOT EXISTS idx_team_invitations_expires ON team_invitations(expires_at)");

    log("  Master schema created");
  } else {
    logDry("Initialize master database schema");
  }

  // Step 5: Copy legacy database to team database
  log("Setting up team database...");
  if (existsSync(LEGACY_DB_PATH)) {
    if (!dryRun) {
      copyFileSync(LEGACY_DB_PATH, TEAM_DB_PATH);
      log(`  Copied ${LEGACY_DB_PATH} -> ${TEAM_DB_PATH}`);
    } else {
      logDry(`Copy ${LEGACY_DB_PATH} -> ${TEAM_DB_PATH}`);
    }
  } else {
    log("  No legacy database to copy (fresh installation)");
  }

  // Step 6: Create team record
  log("Creating team record...");
  let teamId = 0;

  if (!dryRun && masterDb) {
    const createdBy = ADMIN_NPUBS[0] || "system";
    masterDb.run(
      `INSERT INTO teams (slug, display_name, description, created_by)
       VALUES (?, ?, ?, ?)`,
      [TEAM_SLUG, TEAM_DISPLAY_NAME, "Original community migrated to multi-tenant", createdBy]
    );

    const result = masterDb.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get();
    teamId = result?.id || 0;
    log(`  Created team: ${TEAM_DISPLAY_NAME} (id: ${teamId})`);
  } else {
    logDry(`Create team: ${TEAM_DISPLAY_NAME}`);
  }

  // Step 7: Import existing users as team members
  log("Importing users as team members...");
  let userCount = 0;

  if (existsSync(TEAM_DB_PATH) || existsSync(LEGACY_DB_PATH)) {
    const teamDbPath = existsSync(TEAM_DB_PATH) ? TEAM_DB_PATH : LEGACY_DB_PATH;
    const teamDb = new Database(teamDbPath, { readonly: true });

    type UserRow = { npub: string; pubkey: string; display_name: string | null; picture: string | null };
    const users = teamDb.query<UserRow, []>("SELECT npub, pubkey, display_name, picture FROM users").all();
    teamDb.close();

    log(`  Found ${users.length} users in legacy database`);

    for (const user of users) {
      if (!dryRun && masterDb) {
        // Add to global users
        masterDb.run(
          `INSERT OR IGNORE INTO users_global (npub, pubkey, display_name, picture)
           VALUES (?, ?, ?, ?)`,
          [user.npub, user.pubkey, user.display_name, user.picture]
        );

        // Determine role
        const isAdmin = ADMIN_NPUBS.includes(user.npub);
        const role = isAdmin ? "owner" : "member";

        // Add team membership
        masterDb.run(
          `INSERT OR IGNORE INTO team_memberships (team_id, user_npub, role)
           VALUES (?, ?, ?)`,
          [teamId, user.npub, role]
        );

        userCount++;
        if (isAdmin) {
          log(`  Added ${user.npub.slice(0, 16)}... as owner`);
        }
      } else {
        const isAdmin = ADMIN_NPUBS.includes(user.npub);
        logDry(`Add user ${user.npub.slice(0, 16)}... as ${isAdmin ? "owner" : "member"}`);
        userCount++;
      }
    }
  }

  log(`  Imported ${userCount} users`);

  // Step 8: Ensure all admins are owners (even if not in users table yet)
  log("Ensuring admin users are team owners...");
  for (const npub of ADMIN_NPUBS) {
    if (!dryRun && masterDb) {
      // Upsert membership as owner
      masterDb.run(
        `INSERT INTO team_memberships (team_id, user_npub, role)
         VALUES (?, ?, 'owner')
         ON CONFLICT(team_id, user_npub) DO UPDATE SET role = 'owner'`,
        [teamId, npub]
      );
    } else {
      logDry(`Ensure ${npub.slice(0, 16)}... is team owner`);
    }
  }

  // Cleanup
  if (masterDb) {
    masterDb.close();
  }

  log("");
  log("=".repeat(60));
  log("Migration complete!");
  log("=".repeat(60));
  log("");
  log("Next steps:");
  log("1. Update your environment variables:");
  log(`   MASTER_DB_PATH=${MASTER_DB_PATH}`);
  log(`   TEAMS_DB_DIR=${TEAMS_DB_DIR}`);
  log("");
  log("2. The original database is preserved at:");
  log(`   ${LEGACY_DB_PATH}`);
  log("");
  log("3. Start the server and visit /teams to see your team");
  log("");

  if (dryRun) {
    log("This was a dry run. Run without --dry-run to apply changes.");
  }
}

try {
  main();
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}
