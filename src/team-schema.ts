/**
 * Team Database Schema Initialization
 *
 * This module contains the schema initialization for team databases.
 * Each team gets its own isolated SQLite database with the full schema.
 */

import type { Database } from "bun:sqlite";

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
 * Helper function to create indexes safely (ignores "already exists" errors)
 */
function createIndex(db: Database, sql: string): void {
  try {
    db.run(sql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already exists")) {
      throw error;
    }
  }
}

/**
 * Initialize the full team database schema
 *
 * This creates all tables, indexes, and runs migrations for a team database.
 * Safe to call on existing databases - uses IF NOT EXISTS and migration helpers.
 */
export function initTeamSchema(db: Database): void {
  db.run("PRAGMA foreign_keys = ON");

  // ============================================================================
  // Core Tables
  // ============================================================================

  // Todos
  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  addColumn(db, "ALTER TABLE todos ADD COLUMN description TEXT DEFAULT ''");
  addColumn(db, "ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'sand'");
  addColumn(db, "ALTER TABLE todos ADD COLUMN state TEXT NOT NULL DEFAULT 'new'");
  addColumn(db, "ALTER TABLE todos ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE todos ADD COLUMN owner TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE todos ADD COLUMN scheduled_for TEXT DEFAULT NULL");
  addColumn(db, "ALTER TABLE todos ADD COLUMN tags TEXT DEFAULT ''");
  addColumn(db, "ALTER TABLE todos ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE");
  addColumn(db, "ALTER TABLE todos ADD COLUMN assigned_to TEXT DEFAULT NULL");
  addColumn(db, "ALTER TABLE todos ADD COLUMN position INTEGER DEFAULT NULL");
  addColumn(db, "ALTER TABLE todos ADD COLUMN parent_id INTEGER REFERENCES todos(id) ON DELETE SET NULL");
  addColumn(db, "ALTER TABLE todos ADD COLUMN updated_at TEXT DEFAULT NULL");
  createIndex(db, "CREATE INDEX idx_todos_group_id ON todos(group_id)");
  createIndex(db, "CREATE INDEX idx_todos_assigned_to ON todos(assigned_to)");
  createIndex(db, "CREATE INDEX idx_todos_parent_id ON todos(parent_id)");

  // AI Summaries
  db.run(`
    CREATE TABLE IF NOT EXISTS ai_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      summary_date TEXT NOT NULL,
      day_ahead TEXT NULL,
      week_ahead TEXT NULL,
      suggestions TEXT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner, summary_date)
    )
  `);

  // ============================================================================
  // Chat Tables
  // ============================================================================

  // Channels
  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      creator TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name)
    )
  `);
  addColumn(db, "ALTER TABLE channels ADD COLUMN owner_npub TEXT DEFAULT NULL");
  addColumn(db, "ALTER TABLE channels ADD COLUMN encrypted INTEGER DEFAULT 0");
  addColumn(db, "ALTER TABLE channels ADD COLUMN encryption_enabled_at TEXT DEFAULT NULL");

  // DM Participants
  db.run(`
    CREATE TABLE IF NOT EXISTS dm_participants (
      channel_id INTEGER NOT NULL,
      npub TEXT NOT NULL,
      PRIMARY KEY (channel_id, npub),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    )
  `);
  createIndex(db, "CREATE INDEX idx_dm_participants_npub ON dm_participants(npub)");

  // Channel Members
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id INTEGER NOT NULL,
      member TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, member),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    )
  `);

  // Messages
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      thread_root_id INTEGER NULL,
      parent_id INTEGER NULL,
      quoted_message_id INTEGER NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TEXT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (thread_root_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (quoted_message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `);
  addColumn(db, "ALTER TABLE messages ADD COLUMN encrypted INTEGER DEFAULT 0");
  addColumn(db, "ALTER TABLE messages ADD COLUMN key_version INTEGER DEFAULT NULL");
  createIndex(db, "CREATE INDEX idx_messages_channel_created_at ON messages(channel_id, created_at)");
  createIndex(db, "CREATE INDEX idx_messages_thread_order ON messages(thread_root_id, created_at, id)");

  // Message Mentions
  db.run(`
    CREATE TABLE IF NOT EXISTS message_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      mentioned_npub TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);
  createIndex(db, "CREATE UNIQUE INDEX idx_message_mentions_unique ON message_mentions(message_id, mentioned_npub)");

  // Message Reactions
  db.run(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      reactor TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      UNIQUE(message_id, reactor, emoji)
    )
  `);

  // Channel Read State
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_read_state (
      npub TEXT NOT NULL,
      channel_id INTEGER NOT NULL,
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_read_message_id INTEGER,
      PRIMARY KEY (npub, channel_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    )
  `);
  createIndex(db, "CREATE INDEX idx_channel_read_state_npub ON channel_read_state(npub)");

  // ============================================================================
  // Users
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      npub TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      display_name TEXT,
      name TEXT,
      about TEXT,
      picture TEXT,
      nip05 TEXT,
      last_login TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  addColumn(db, "ALTER TABLE users ADD COLUMN onboarded INTEGER DEFAULT 0");
  addColumn(db, "ALTER TABLE users ADD COLUMN onboarded_at INTEGER DEFAULT NULL");
  createIndex(db, "CREATE INDEX idx_users_pubkey ON users(pubkey)");

  // ============================================================================
  // Groups & Permissions
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      npub TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, npub),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )
  `);
  createIndex(db, "CREATE INDEX idx_group_members_npub ON group_members(npub)");

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_groups (
      channel_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (channel_id, group_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )
  `);
  createIndex(db, "CREATE INDEX idx_channel_groups_channel ON channel_groups(channel_id)");
  createIndex(db, "CREATE INDEX idx_channel_groups_group ON channel_groups(group_id)");

  // ============================================================================
  // Push Notifications
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npub TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh_key TEXT NOT NULL,
      auth_key TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'on_update',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_sent_at TEXT,
      is_active INTEGER DEFAULT 1,
      UNIQUE(npub, endpoint)
    )
  `);
  createIndex(db, "CREATE INDEX idx_push_subs_npub ON push_subscriptions(npub)");
  createIndex(db, "CREATE INDEX idx_push_subs_active ON push_subscriptions(is_active, frequency)");

  db.run(`
    CREATE TABLE IF NOT EXISTS vapid_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // Task-Thread Links
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS task_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      linked_by TEXT NOT NULL,
      linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(todo_id, message_id)
    )
  `);
  createIndex(db, "CREATE INDEX idx_task_threads_todo ON task_threads(todo_id)");
  createIndex(db, "CREATE INDEX idx_task_threads_message ON task_threads(message_id)");

  // ============================================================================
  // Pinned Messages
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      pinned_by TEXT NOT NULL,
      pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, message_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);
  createIndex(db, "CREATE INDEX idx_pinned_messages_channel ON pinned_messages(channel_id)");
  createIndex(db, "CREATE INDEX idx_pinned_messages_message ON pinned_messages(message_id)");

  // ============================================================================
  // Task-CRM Links
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS task_crm_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
      company_id INTEGER REFERENCES crm_companies(id) ON DELETE CASCADE,
      activity_id INTEGER REFERENCES crm_activities(id) ON DELETE CASCADE,
      opportunity_id INTEGER REFERENCES crm_opportunities(id) ON DELETE CASCADE,
      linked_by TEXT NOT NULL,
      linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  createIndex(db, "CREATE INDEX idx_task_crm_links_todo ON task_crm_links(todo_id)");
  createIndex(db, "CREATE INDEX idx_task_crm_links_contact ON task_crm_links(contact_id)");
  createIndex(db, "CREATE INDEX idx_task_crm_links_company ON task_crm_links(company_id)");
  createIndex(db, "CREATE INDEX idx_task_crm_links_activity ON task_crm_links(activity_id)");
  createIndex(db, "CREATE INDEX idx_task_crm_links_opportunity ON task_crm_links(opportunity_id)");

  // ============================================================================
  // App Settings
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // Wingman Costs
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS wingman_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npub TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  createIndex(db, "CREATE INDEX idx_wingman_costs_npub ON wingman_costs(npub)");
  createIndex(db, "CREATE INDEX idx_wingman_costs_created ON wingman_costs(created_at)");

  // ============================================================================
  // Encryption Keys
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS user_channel_keys (
      user_pubkey TEXT NOT NULL,
      channel_id INTEGER NOT NULL,
      encrypted_key TEXT NOT NULL,
      key_version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_pubkey, channel_id, key_version),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    )
  `);
  createIndex(db, "CREATE INDEX idx_user_channel_keys_channel ON user_channel_keys(channel_id)");

  db.run(`
    CREATE TABLE IF NOT EXISTS community_keys (
      user_pubkey TEXT PRIMARY KEY,
      encrypted_key TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS community_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================================================
  // Team Encryption (Zero-Knowledge Key Distribution)
  // ============================================================================

  // Team-level encryption configuration
  // The team_pubkey is derived from the first invite code and used for key escrow
  db.run(`
    CREATE TABLE IF NOT EXISTS team_encryption (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      team_pubkey TEXT NOT NULL,
      initialized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      initialized_by TEXT NOT NULL
    )
  `);

  // User-specific encrypted copies of the team key
  // Each user has the team key encrypted to their own Nostr pubkey
  db.run(`
    CREATE TABLE IF NOT EXISTS user_team_keys (
      user_pubkey TEXT PRIMARY KEY,
      encrypted_team_key TEXT NOT NULL,
      wrapped_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  createIndex(db, "CREATE INDEX idx_user_team_keys_wrapped_by ON user_team_keys(wrapped_by)");

  // ============================================================================
  // Invite Codes
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT UNIQUE NOT NULL,
      encrypted_key TEXT NOT NULL,
      single_use INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      redeemed_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
  // Add columns for zero-knowledge team encryption
  // encrypted_team_key: NIP-44 encrypted team key, wrapped for the invite-derived pubkey
  // creator_pubkey: Public key of the invite creator (needed for decryption)
  addColumn(db, "ALTER TABLE invite_codes ADD COLUMN encrypted_team_key TEXT DEFAULT NULL");
  addColumn(db, "ALTER TABLE invite_codes ADD COLUMN creator_pubkey TEXT DEFAULT NULL");
  createIndex(db, "CREATE INDEX idx_invite_codes_expires ON invite_codes(expires_at)");

  db.run(`
    CREATE TABLE IF NOT EXISTS invite_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id INTEGER NOT NULL,
      user_npub TEXT NOT NULL,
      redeemed_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (invite_id) REFERENCES invite_codes(id) ON DELETE CASCADE,
      UNIQUE(invite_id, user_npub)
    )
  `);

  // ============================================================================
  // Key Requests - For distributing encryption keys to new members
  // ============================================================================
  // When a user joins via invite and is added to private groups, they need
  // encryption keys for those channels. Key requests are created automatically
  // and fulfilled by the invite creator (manager) when their client is online.

  db.run(`
    CREATE TABLE IF NOT EXISTS key_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      requester_npub TEXT NOT NULL,
      requester_pubkey TEXT NOT NULL,
      target_npub TEXT NOT NULL,
      invite_code_hash TEXT,
      group_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      fulfilled_by TEXT,
      fulfilled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, requester_npub)
    )
  `);
  createIndex(db, "CREATE INDEX idx_key_requests_target ON key_requests(target_npub, status)");
  createIndex(db, "CREATE INDEX idx_key_requests_requester ON key_requests(requester_npub)");

  // ============================================================================
  // CRM Tables
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS crm_companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      website TEXT,
      industry TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0
    )
  `);
  createIndex(db, "CREATE INDEX idx_crm_companies_name ON crm_companies(name)");
  createIndex(db, "CREATE INDEX idx_crm_companies_deleted ON crm_companies(deleted)");

  db.run(`
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      npub TEXT,
      twitter TEXT,
      linkedin TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (company_id) REFERENCES crm_companies(id) ON DELETE SET NULL
    )
  `);
  createIndex(db, "CREATE INDEX idx_crm_contacts_company ON crm_contacts(company_id)");
  createIndex(db, "CREATE INDEX idx_crm_contacts_name ON crm_contacts(name)");
  createIndex(db, "CREATE INDEX idx_crm_contacts_email ON crm_contacts(email)");
  createIndex(db, "CREATE INDEX idx_crm_contacts_npub ON crm_contacts(npub)");
  createIndex(db, "CREATE INDEX idx_crm_contacts_deleted ON crm_contacts(deleted)");

  db.run(`
    CREATE TABLE IF NOT EXISTS crm_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      contact_id INTEGER,
      title TEXT NOT NULL,
      value REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      stage TEXT NOT NULL DEFAULT 'lead',
      probability INTEGER NOT NULL DEFAULT 0,
      expected_close TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (company_id) REFERENCES crm_companies(id) ON DELETE SET NULL,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL
    )
  `);
  createIndex(db, "CREATE INDEX idx_crm_opportunities_company ON crm_opportunities(company_id)");
  createIndex(db, "CREATE INDEX idx_crm_opportunities_contact ON crm_opportunities(contact_id)");
  createIndex(db, "CREATE INDEX idx_crm_opportunities_stage ON crm_opportunities(stage)");
  createIndex(db, "CREATE INDEX idx_crm_opportunities_deleted ON crm_opportunities(deleted)");

  db.run(`
    CREATE TABLE IF NOT EXISTS crm_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER,
      opportunity_id INTEGER,
      company_id INTEGER,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT,
      activity_date TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL,
      FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities(id) ON DELETE SET NULL,
      FOREIGN KEY (company_id) REFERENCES crm_companies(id) ON DELETE SET NULL
    )
  `);
  createIndex(db, "CREATE INDEX idx_crm_activities_contact ON crm_activities(contact_id)");
  createIndex(db, "CREATE INDEX idx_crm_activities_opportunity ON crm_activities(opportunity_id)");
  createIndex(db, "CREATE INDEX idx_crm_activities_company ON crm_activities(company_id)");
  createIndex(db, "CREATE INDEX idx_crm_activities_type ON crm_activities(type)");
  createIndex(db, "CREATE INDEX idx_crm_activities_date ON crm_activities(activity_date)");
  createIndex(db, "CREATE INDEX idx_crm_activities_deleted ON crm_activities(deleted)");

  // ============================================================================
  // Wallet Transactions
  // ============================================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npub TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('incoming', 'outgoing')),
      amount_msats INTEGER NOT NULL,
      invoice TEXT,
      payment_hash TEXT,
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'settled', 'failed')),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      settled_at TEXT
    )
  `);
  createIndex(db, "CREATE INDEX idx_wallet_tx_npub ON wallet_transactions(npub)");
  createIndex(db, "CREATE INDEX idx_wallet_tx_created ON wallet_transactions(created_at)");
}
