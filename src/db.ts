import { Database } from "bun:sqlite";

import type { NotificationFrequency, TodoPriority, TodoState } from "./types";

export type Todo = {
  id: number;
  title: string;
  owner: string;
  description: string;
  priority: TodoPriority;
  state: TodoState;
  done: number;
  deleted: number;
  created_at: string;
  scheduled_for: string | null;
  tags: string;
  group_id: number | null;
  assigned_to: string | null;
  position: number | null;
  parent_id: number | null;
};

export type TodoWithBoard = Todo & {
  group_name: string | null;
};

export type Summary = {
  id: number;
  owner: string;
  summary_date: string;
  day_ahead: string | null;
  week_ahead: string | null;
  suggestions: string | null;
  created_at: string;
  updated_at: string;
};

export type Channel = {
  id: number;
  name: string;
  display_name: string;
  description: string;
  creator: string;
  is_public: number;
  owner_npub: string | null; // If set, this is a personal channel visible only to this user
  encrypted: number; // 0 = plaintext, 1 = E2E encrypted
  encryption_enabled_at: string | null;
  created_at: string;
};

export type DmParticipant = {
  channel_id: number;
  npub: string;
};

export type Message = {
  id: number;
  channel_id: number;
  author: string;
  body: string;
  thread_root_id: number | null;
  parent_id: number | null;
  quoted_message_id: number | null;
  encrypted: number; // 0 = plaintext, 1 = AES-256-GCM ciphertext
  key_version: number | null; // Which key version was used for encryption
  created_at: string;
  edited_at: string | null;
};

export type Reaction = {
  id: number;
  message_id: number;
  reactor: string;
  emoji: string;
  created_at: string;
};

export type ReactionGroup = {
  emoji: string;
  count: number;
  reactors: string[];
};

export type ChannelReadState = {
  npub: string;
  channel_id: number;
  last_read_at: string;
  last_read_message_id: number | null;
};

export type UnreadCount = {
  channel_id: number;
  unread_count: number;
  mention_count: number;
};

export type User = {
  npub: string;
  pubkey: string;
  display_name: string | null;
  name: string | null;
  about: string | null;
  picture: string | null;
  nip05: string | null;
  last_login: string | null;
  updated_at: string;
};

export type Group = {
  id: number;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
};

export type GroupMember = {
  group_id: number;
  npub: string;
  added_at: string;
};

export type ChannelGroup = {
  channel_id: number;
  group_id: number;
};

export type PushSubscription = {
  id: number;
  npub: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  frequency: NotificationFrequency;
  created_at: string;
  last_sent_at: string | null;
  is_active: number;
};

export type VapidConfig = {
  id: number;
  public_key: string;
  private_key: string;
  contact_email: string;
  created_at: string;
};

export type TaskThread = {
  id: number;
  todo_id: number;
  message_id: number;
  linked_by: string;
  linked_at: string;
};

export type PinnedMessage = {
  id: number;
  channel_id: number;
  message_id: number;
  pinned_by: string;
  pinned_at: string;
};

export type TaskCrmLink = {
  id: number;
  todo_id: number;
  contact_id: number | null;
  company_id: number | null;
  activity_id: number | null;
  opportunity_id: number | null;
  linked_by: string;
  linked_at: string;
};

export type AppSetting = {
  key: string;
  value: string;
  updated_at: string;
};

export type WingmanCost = {
  id: number;
  npub: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  created_at: string;
};

export type UserChannelKey = {
  user_pubkey: string;
  channel_id: number;
  encrypted_key: string; // JSON structure with NIP-44 encrypted channel key
  key_version: number;
  created_at: string;
};

export type CommunityKey = {
  user_pubkey: string;
  encrypted_key: string; // NIP-44 wrapped community key
  created_at: string;
};

export type CommunityState = {
  key: string;
  value: string;
  updated_at: string;
};

export type InviteCode = {
  id: number;
  code_hash: string;
  encrypted_key: string; // AES-GCM(community_key, HKDF(code))
  single_use: number;
  created_by: string;
  expires_at: number;
  redeemed_count: number;
  created_at: number;
};

export type InviteRedemption = {
  id: number;
  invite_id: number;
  user_npub: string;
  redeemed_at: number;
};

// Team Encryption Types (Zero-Knowledge Key Distribution)
export type TeamEncryption = {
  id: number;
  team_pubkey: string; // Nostr pubkey for the team (derived from first invite)
  initialized_at: string;
  initialized_by: string;
};

export type UserTeamKey = {
  user_pubkey: string;
  encrypted_team_key: string; // NIP-44 wrapped team key for this user
  wrapped_by: string; // Pubkey of who wrapped this key
  created_at: string;
  updated_at: string;
};

// CRM Types
export type CrmCompany = {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted: number;
};

export type CrmContact = {
  id: number;
  company_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  npub: string | null;
  twitter: string | null;
  linkedin: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted: number;
};

export type CrmOpportunityStage = "lead" | "qualified" | "proposal" | "negotiation" | "closed_won" | "closed_lost";

export type CrmOpportunity = {
  id: number;
  company_id: number | null;
  contact_id: number | null;
  title: string;
  value: number | null;
  currency: string;
  stage: CrmOpportunityStage;
  probability: number;
  expected_close: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted: number;
};

export type CrmActivityType = "call" | "email" | "meeting" | "note" | "task";

export type CrmActivity = {
  id: number;
  contact_id: number | null;
  opportunity_id: number | null;
  company_id: number | null;
  type: CrmActivityType;
  subject: string;
  description: string | null;
  activity_date: string;
  created_by: string;
  created_at: string;
  deleted: number;
};

export type WalletTransaction = {
  id: number;
  npub: string;
  type: "incoming" | "outgoing";
  amount_msats: number;
  invoice: string | null;
  payment_hash: string | null;
  state: "pending" | "settled" | "failed";
  description: string | null;
  created_at: string;
  settled_at: string | null;
};

export type DbSession = {
  token: string;
  pubkey: string;
  npub: string;
  method: string;
  created_at: number;
  expires_at: number;
  current_team_id: number | null;
  current_team_slug: string | null;
  team_memberships: string | null;
};

const dbPath = process.env.DB_PATH || Bun.env.DB_PATH || "marginal-gains.sqlite";
const db = new Database(dbPath);
db.run("PRAGMA foreign_keys = ON");

db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const addColumn = (sql: string) => {
  try {
    db.run(sql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column")) {
      throw error;
    }
  }
};

addColumn("ALTER TABLE todos ADD COLUMN description TEXT DEFAULT ''");
addColumn("ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'sand'");
addColumn("ALTER TABLE todos ADD COLUMN state TEXT NOT NULL DEFAULT 'new'");
addColumn("ALTER TABLE todos ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE todos ADD COLUMN owner TEXT NOT NULL DEFAULT ''");
addColumn("ALTER TABLE todos ADD COLUMN scheduled_for TEXT DEFAULT NULL");
addColumn("ALTER TABLE todos ADD COLUMN tags TEXT DEFAULT ''");
addColumn("ALTER TABLE todos ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE");
addColumn("ALTER TABLE todos ADD COLUMN assigned_to TEXT DEFAULT NULL");
addColumn("ALTER TABLE todos ADD COLUMN position INTEGER DEFAULT NULL");
addColumn("ALTER TABLE todos ADD COLUMN parent_id INTEGER REFERENCES todos(id) ON DELETE SET NULL");

// Index for efficient group todo queries
try {
  db.run("CREATE INDEX idx_todos_group_id ON todos(group_id)");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("already exists")) {
    throw error;
  }
}

// Index for efficient assigned_to queries (All My Tasks view)
try {
  db.run("CREATE INDEX idx_todos_assigned_to ON todos(assigned_to)");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("already exists")) {
    throw error;
  }
}

// Index for efficient parent/child queries
try {
  db.run("CREATE INDEX idx_todos_parent_id ON todos(parent_id)");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("already exists")) {
    throw error;
  }
}

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

// Create channels table first (other tables reference it)
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

// Add owner_npub for personal channels (Note to self) - migration for existing DBs
addColumn("ALTER TABLE channels ADD COLUMN owner_npub TEXT DEFAULT NULL");

// DM participants table - tracks the two users in a DM channel
db.run(`
  CREATE TABLE IF NOT EXISTS dm_participants (
    channel_id INTEGER NOT NULL,
    npub TEXT NOT NULL,
    PRIMARY KEY (channel_id, npub),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_dm_participants_npub ON dm_participants(npub)");

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

db.run("CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at ON messages(channel_id, created_at)");
db.run(
  "CREATE INDEX IF NOT EXISTS idx_messages_thread_order ON messages(thread_root_id, created_at, id)"
);

db.run(`
  CREATE TABLE IF NOT EXISTS message_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    mentioned_npub TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  )
`);
db.run(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_message_mentions_unique ON message_mentions(message_id, mentioned_npub)"
);

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

// Channel read state - tracks when user last read each channel
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
db.run("CREATE INDEX IF NOT EXISTS idx_channel_read_state_npub ON channel_read_state(npub)");

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
db.run("CREATE INDEX IF NOT EXISTS idx_users_pubkey ON users(pubkey)");

// Groups for permission management
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

db.run(`
  CREATE TABLE IF NOT EXISTS channel_groups (
    channel_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (channel_id, group_id),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_channel_groups_channel ON channel_groups(channel_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_channel_groups_group ON channel_groups(group_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_group_members_npub ON group_members(npub)");

// Push notification subscriptions
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
db.run("CREATE INDEX IF NOT EXISTS idx_push_subs_npub ON push_subscriptions(npub)");
db.run("CREATE INDEX IF NOT EXISTS idx_push_subs_active ON push_subscriptions(is_active, frequency)");

// VAPID keys (singleton table)
db.run(`
  CREATE TABLE IF NOT EXISTS vapid_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// Task-thread links (many-to-many relationship)
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
db.run("CREATE INDEX IF NOT EXISTS idx_task_threads_todo ON task_threads(todo_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_task_threads_message ON task_threads(message_id)");

// Pinned Messages - tracks messages pinned to channel headers
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
db.run("CREATE INDEX IF NOT EXISTS idx_pinned_messages_channel ON pinned_messages(channel_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_pinned_messages_message ON pinned_messages(message_id)");

// Task-CRM links (link tasks to CRM entities)
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
db.run("CREATE INDEX IF NOT EXISTS idx_task_crm_links_todo ON task_crm_links(todo_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_task_crm_links_contact ON task_crm_links(contact_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_task_crm_links_company ON task_crm_links(company_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_task_crm_links_activity ON task_crm_links(activity_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_task_crm_links_opportunity ON task_crm_links(opportunity_id)");

// App-wide settings table (key-value store)
db.run(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// Wingman cost tracking table
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
db.run("CREATE INDEX IF NOT EXISTS idx_wingman_costs_npub ON wingman_costs(npub)");
db.run("CREATE INDEX IF NOT EXISTS idx_wingman_costs_created ON wingman_costs(created_at)");

// User channel keys for E2E encryption
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
db.run("CREATE INDEX IF NOT EXISTS idx_user_channel_keys_channel ON user_channel_keys(channel_id)");

// Add encryption columns to channels table
addColumn("ALTER TABLE channels ADD COLUMN encrypted INTEGER DEFAULT 0");
addColumn("ALTER TABLE channels ADD COLUMN encryption_enabled_at TEXT DEFAULT NULL");

// Add encryption columns to messages table
addColumn("ALTER TABLE messages ADD COLUMN encrypted INTEGER DEFAULT 0");
addColumn("ALTER TABLE messages ADD COLUMN key_version INTEGER DEFAULT NULL");

// Community key storage - wrapped community key per user
db.run(`
  CREATE TABLE IF NOT EXISTS community_keys (
    user_pubkey TEXT PRIMARY KEY,
    encrypted_key TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Community state - tracks bootstrap and migration status
db.run(`
  CREATE TABLE IF NOT EXISTS community_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Invite codes for onboarding
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
db.run("CREATE INDEX IF NOT EXISTS idx_invite_codes_expires ON invite_codes(expires_at)");

// Track invite code redemptions
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

// Add onboarded status to users
addColumn("ALTER TABLE users ADD COLUMN onboarded INTEGER DEFAULT 0");
addColumn("ALTER TABLE users ADD COLUMN onboarded_at INTEGER DEFAULT NULL");

// CRM Tables
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
db.run("CREATE INDEX IF NOT EXISTS idx_crm_companies_name ON crm_companies(name)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_companies_deleted ON crm_companies(deleted)");

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
db.run("CREATE INDEX IF NOT EXISTS idx_crm_contacts_company ON crm_contacts(company_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_contacts_name ON crm_contacts(name)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_contacts_npub ON crm_contacts(npub)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_contacts_deleted ON crm_contacts(deleted)");

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
db.run("CREATE INDEX IF NOT EXISTS idx_crm_opportunities_company ON crm_opportunities(company_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_opportunities_contact ON crm_opportunities(contact_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_opportunities_stage ON crm_opportunities(stage)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_opportunities_deleted ON crm_opportunities(deleted)");

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
db.run("CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_activities_opportunity ON crm_activities(opportunity_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_activities_company ON crm_activities(company_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_activities_type ON crm_activities(type)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_activities_date ON crm_activities(activity_date)");
db.run("CREATE INDEX IF NOT EXISTS idx_crm_activities_deleted ON crm_activities(deleted)");

// Wallet transaction cache table
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
db.run("CREATE INDEX IF NOT EXISTS idx_wallet_tx_npub ON wallet_transactions(npub)");
db.run("CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON wallet_transactions(created_at)");

// Sessions table for persistent login
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    npub TEXT NOT NULL,
    method TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    current_team_id INTEGER,
    current_team_slug TEXT,
    team_memberships TEXT
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)");
db.run("CREATE INDEX IF NOT EXISTS idx_sessions_npub ON sessions(npub)");

const listByOwnerStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND owner = ? AND group_id IS NULL ORDER BY state, position IS NULL, position ASC, created_at DESC"
);
const listByGroupStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND group_id = ? ORDER BY state, position IS NULL, position ASC, created_at DESC"
);
const listByGroupAssignedStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND group_id = ? AND assigned_to = ? ORDER BY state, position IS NULL, position ASC, created_at DESC"
);
const listAllAssignedStmt = db.query<Todo & { group_name: string | null }>(
  `SELECT todos.*, groups.name as group_name
   FROM todos
   LEFT JOIN groups ON todos.group_id = groups.id
   WHERE todos.deleted = 0
     AND (
       todos.assigned_to = ?1
       OR (todos.owner = ?1 AND todos.group_id IS NULL)
     )
   ORDER BY todos.state, todos.position IS NULL, todos.position ASC, todos.created_at DESC`
);
const listScheduledStmt = db.query<Todo>(
  `SELECT * FROM todos
   WHERE deleted = 0
     AND owner = ?
     AND scheduled_for IS NOT NULL
     AND scheduled_for != ''
     AND date(scheduled_for) <= date(?)
   ORDER BY scheduled_for ASC, created_at DESC`
);
const listUnscheduledStmt = db.query<Todo>(
  `SELECT * FROM todos
   WHERE deleted = 0
     AND owner = ?
     AND (scheduled_for IS NULL OR scheduled_for = '')
   ORDER BY created_at DESC`
);
const insertStmt = db.query<Todo>(
  "INSERT INTO todos (title, description, priority, state, done, owner, tags, group_id, assigned_to) VALUES (?, '', 'sand', 'new', 0, ?, ?, ?, ?) RETURNING *"
);
const insertFullStmt = db.query<Todo>(
  `INSERT INTO todos (title, description, priority, state, done, owner, scheduled_for, tags, group_id, assigned_to)
   VALUES (?, ?, ?, ?, CASE WHEN ? = 'done' THEN 1 ELSE 0 END, ?, ?, ?, ?, ?)
   RETURNING *`
);
const deleteStmt = db.query("UPDATE todos SET deleted = 1 WHERE id = ? AND owner = ?");
const deleteGroupTodoStmt = db.query("UPDATE todos SET deleted = 1 WHERE id = ? AND group_id = ?");
const getTodoByIdStmt = db.query<Todo>("SELECT * FROM todos WHERE id = ? AND deleted = 0");

// Subtask queries
const listSubtasksStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE parent_id = ? AND deleted = 0 ORDER BY position ASC, created_at DESC"
);
const countSubtasksStmt = db.query<{ count: number }>(
  "SELECT COUNT(*) as count FROM todos WHERE parent_id = ? AND deleted = 0"
);
const insertSubtaskStmt = db.query<Todo>(
  `INSERT INTO todos (title, description, priority, state, done, owner, tags, group_id, assigned_to, parent_id)
   SELECT ?, '', 'sand', 'new', 0, owner, '', group_id, ?, ?
   FROM todos WHERE id = ?
   RETURNING *`
);
const setParentStmt = db.query<Todo>(
  "UPDATE todos SET parent_id = ? WHERE id = ? RETURNING *"
);
const orphanSubtasksStmt = db.query(
  "UPDATE todos SET parent_id = NULL WHERE parent_id = ?"
);
const propagateTagsStmt = db.query(
  "UPDATE todos SET tags = ? WHERE parent_id = ? AND deleted = 0"
);

const updateStmt = db.query<Todo>(
  `UPDATE todos
   SET
    title = ?,
    description = ?,
    priority = ?,
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    scheduled_for = ?,
    tags = ?,
    assigned_to = ?
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const transitionStmt = db.query<Todo>(
  `UPDATE todos
   SET
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const transitionWithPositionStmt = db.query<Todo>(
  `UPDATE todos
   SET
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    position = ?
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const updatePositionStmt = db.query<Todo>(
  `UPDATE todos SET position = ? WHERE id = ? RETURNING *`
);
const updateGroupTodoStmt = db.query<Todo>(
  `UPDATE todos
   SET
    title = ?,
    description = ?,
    priority = ?,
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    scheduled_for = ?,
    tags = ?,
    assigned_to = ?
   WHERE id = ? AND group_id = ?
   RETURNING *`
);
const transitionGroupTodoStmt = db.query<Todo>(
  `UPDATE todos
   SET
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END
   WHERE id = ? AND group_id = ?
   RETURNING *`
);
const transitionGroupTodoWithPositionStmt = db.query<Todo>(
  `UPDATE todos
   SET
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    position = ?
   WHERE id = ? AND group_id = ?
   RETURNING *`
);
const moveTodoBoardStmt = db.query<Todo>(
  `UPDATE todos
   SET group_id = ?, assigned_to = ?
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const upsertSummaryStmt = db.query<Summary>(
  `INSERT INTO ai_summaries (owner, summary_date, day_ahead, week_ahead, suggestions)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(owner, summary_date) DO UPDATE SET
     day_ahead = excluded.day_ahead,
     week_ahead = excluded.week_ahead,
     suggestions = excluded.suggestions,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`
);
const latestDaySummaryStmt = db.query<Summary>(
  `SELECT * FROM ai_summaries
   WHERE owner = ? AND summary_date = ?
   ORDER BY updated_at DESC
   LIMIT 1`
);
const latestWeekSummaryStmt = db.query<Summary>(
  `SELECT * FROM ai_summaries
   WHERE owner = ? AND summary_date BETWEEN ? AND ?
   ORDER BY updated_at DESC
   LIMIT 1`
);

// Channel statements (excludes personal channels and DM channels)
const listChannelsStmt = db.query<Channel>(
  `SELECT * FROM channels
   WHERE owner_npub IS NULL
   AND name NOT LIKE 'dm-%'
   ORDER BY created_at ASC`
);
const getChannelByIdStmt = db.query<Channel>(
  "SELECT * FROM channels WHERE id = ?"
);
const getChannelByNameStmt = db.query<Channel>(
  "SELECT * FROM channels WHERE name = ?"
);
const insertChannelStmt = db.query<Channel>(
  `INSERT INTO channels (name, display_name, description, creator, is_public)
   VALUES (?, ?, ?, ?, ?)
   RETURNING *`
);
const insertEncryptedChannelStmt = db.query<Channel>(
  `INSERT INTO channels (name, display_name, description, creator, is_public, encrypted, encryption_enabled_at)
   VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
   RETURNING *`
);
const updateChannelStmt = db.query<Channel>(
  `UPDATE channels SET display_name = ?, description = ?, is_public = ?
   WHERE id = ? RETURNING *`
);
const deleteChannelStmt = db.query("DELETE FROM channels WHERE id = ?");

// Message statements
const listMessagesStmt = db.query<Message>(
  `SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at ASC`
);
const listThreadMessagesStmt = db.query<Message>(
  `SELECT * FROM messages
   WHERE thread_root_id = ? OR id = ?
   ORDER BY created_at ASC, id ASC`
);
const insertMessageStmt = db.query<Message>(
  `INSERT INTO messages (channel_id, author, body, thread_root_id, parent_id, quoted_message_id)
   VALUES (?, ?, ?, ?, ?, ?)
   RETURNING *`
);
const insertEncryptedMessageStmt = db.query<Message>(
  `INSERT INTO messages (channel_id, author, body, thread_root_id, parent_id, quoted_message_id, encrypted, key_version)
   VALUES (?, ?, ?, ?, ?, ?, 1, ?)
   RETURNING *`
);
const getMessageByIdStmt = db.query<Message>(
  "SELECT * FROM messages WHERE id = ?"
);
const deleteMessageStmt = db.query("DELETE FROM messages WHERE id = ?");

// Reaction statements
const getReactionStmt = db.query<Reaction>(
  "SELECT * FROM message_reactions WHERE message_id = ? AND reactor = ? AND emoji = ?"
);
const insertReactionStmt = db.query<Reaction>(
  `INSERT INTO message_reactions (message_id, reactor, emoji)
   VALUES (?, ?, ?)
   RETURNING *`
);
const deleteReactionStmt = db.query(
  "DELETE FROM message_reactions WHERE message_id = ? AND reactor = ? AND emoji = ?"
);
const listReactionsForMessageStmt = db.query<Reaction>(
  "SELECT * FROM message_reactions WHERE message_id = ? ORDER BY created_at ASC"
);

// Channel read state statements
const getReadStateStmt = db.query<ChannelReadState>(
  "SELECT * FROM channel_read_state WHERE npub = ? AND channel_id = ?"
);
const upsertReadStateStmt = db.query<ChannelReadState>(
  `INSERT INTO channel_read_state (npub, channel_id, last_read_at, last_read_message_id)
   VALUES (?, ?, CURRENT_TIMESTAMP, ?)
   ON CONFLICT(npub, channel_id) DO UPDATE SET
     last_read_at = CURRENT_TIMESTAMP,
     last_read_message_id = excluded.last_read_message_id
   RETURNING *`
);
const getUnreadCountsStmt = db.query<UnreadCount>(
  `SELECT
     c.id as channel_id,
     COALESCE(SUM(CASE WHEN m.id > COALESCE(crs.last_read_message_id, 0) AND m.author != ? THEN 1 ELSE 0 END), 0) as unread_count,
     COALESCE(SUM(CASE WHEN m.id > COALESCE(crs.last_read_message_id, 0)
       AND m.author != ?
       AND EXISTS (SELECT 1 FROM message_mentions mm WHERE mm.message_id = m.id AND mm.mentioned_npub = ?)
       THEN 1 ELSE 0 END), 0) as mention_count
   FROM channels c
   LEFT JOIN messages m ON m.channel_id = c.id
   LEFT JOIN channel_read_state crs ON crs.channel_id = c.id AND crs.npub = ?
   WHERE c.owner_npub IS NULL OR c.owner_npub = ?
   GROUP BY c.id`
);

export function listTodos(owner: string | null, filterTags?: string[]) {
  if (!owner) return [];
  const todos = listByOwnerStmt.all(owner);
  if (!filterTags || filterTags.length === 0) return todos;
  // Filter todos that have at least one of the specified tags
  return todos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  });
}

export function listGroupTodos(groupId: number, filterTags?: string[], assigneeFilter?: string) {
  const todos = assigneeFilter
    ? listByGroupAssignedStmt.all(groupId, assigneeFilter)
    : listByGroupStmt.all(groupId);
  if (!filterTags || filterTags.length === 0) return todos;
  return todos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  });
}

export function listAllAssignedTodos(npub: string, filterTags?: string[]): TodoWithBoard[] {
  const todos = listAllAssignedStmt.all(npub);
  if (!filterTags || filterTags.length === 0) return todos;
  return todos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  });
}

export function getTodoById(id: number) {
  return getTodoByIdStmt.get(id) as Todo | undefined ?? null;
}

export function moveTodoToBoard(id: number, owner: string, newGroupId: number | null, newAssignee: string | null) {
  return moveTodoBoardStmt.get(newGroupId, newAssignee, id, owner) ?? null;
}

export function listScheduledTodos(owner: string, endDate: string) {
  return listScheduledStmt.all(owner, endDate);
}

export function listUnscheduledTodos(owner: string) {
  return listUnscheduledStmt.all(owner);
}

export function addTodo(title: string, owner: string, tags: string = "", groupId: number | null = null, assignedTo: string | null = null) {
  if (!title.trim()) return null;
  const todo = insertStmt.get(title.trim(), owner, tags, groupId, assignedTo) as Todo | undefined;
  return todo ?? null;
}

export function addTodoFull(
  owner: string,
  fields: {
    title: string;
    description?: string;
    priority?: TodoPriority;
    state?: TodoState;
    scheduled_for?: string | null;
    tags?: string;
    assigned_to?: string | null;
  },
  groupId: number | null = null
) {
  const title = fields.title?.trim();
  if (!title) return null;
  const description = fields.description?.trim() ?? "";
  const priority = fields.priority ?? "sand";
  const state = fields.state ?? "new";
  const scheduled_for = fields.scheduled_for ?? null;
  const tags = fields.tags?.trim() ?? "";
  const assigned_to = fields.assigned_to ?? null;
  const todo = insertFullStmt.get(
    title,
    description,
    priority,
    state,
    state,
    owner,
    scheduled_for,
    tags,
    groupId,
    assigned_to
  ) as Todo | undefined;
  return todo ?? null;
}

export function deleteTodo(id: number, owner: string) {
  deleteStmt.run(id, owner);
}

export function updateTodo(
  id: number,
  owner: string,
  fields: {
    title: string;
    description: string;
    priority: TodoPriority;
    state: TodoState;
    scheduled_for: string | null;
    tags: string;
    assigned_to: string | null;
  }
) {
  const todo = updateStmt.get(
    fields.title,
    fields.description,
    fields.priority,
    fields.state,
    fields.state,
    fields.scheduled_for,
    fields.tags,
    fields.assigned_to,
    id,
    owner
  ) as Todo | undefined;
  return todo ?? null;
}

export function transitionTodo(id: number, owner: string, state: TodoState) {
  const todo = transitionStmt.get(state, state, id, owner) as Todo | undefined;
  return todo ?? null;
}

export function transitionTodoWithPosition(id: number, owner: string, state: TodoState, position: number | null) {
  const todo = transitionWithPositionStmt.get(state, state, position, id, owner) as Todo | undefined;
  return todo ?? null;
}

export function updateTodoPosition(id: number, position: number | null) {
  const todo = updatePositionStmt.get(position, id) as Todo | undefined;
  return todo ?? null;
}

// Group todo functions
export function deleteGroupTodo(id: number, groupId: number) {
  deleteGroupTodoStmt.run(id, groupId);
}

export function updateGroupTodo(
  id: number,
  groupId: number,
  fields: {
    title: string;
    description: string;
    priority: TodoPriority;
    state: TodoState;
    scheduled_for: string | null;
    tags: string;
    assigned_to: string | null;
  }
) {
  const todo = updateGroupTodoStmt.get(
    fields.title,
    fields.description,
    fields.priority,
    fields.state,
    fields.state,
    fields.scheduled_for,
    fields.tags,
    fields.assigned_to,
    id,
    groupId
  ) as Todo | undefined;
  return todo ?? null;
}

export function transitionGroupTodo(id: number, groupId: number, state: TodoState) {
  const todo = transitionGroupTodoStmt.get(state, state, id, groupId) as Todo | undefined;
  return todo ?? null;
}

export function transitionGroupTodoWithPosition(id: number, groupId: number, state: TodoState, position: number | null) {
  const todo = transitionGroupTodoWithPositionStmt.get(state, state, position, id, groupId) as Todo | undefined;
  return todo ?? null;
}

export function assignAllTodosToOwner(npub: string) {
  if (!npub) return;
  db.run("UPDATE todos SET owner = ? WHERE owner = '' OR owner IS NULL", npub);
}

// Subtask helper functions
export function listSubtasks(parentId: number): Todo[] {
  return listSubtasksStmt.all(parentId);
}

export function hasSubtasks(todoId: number): boolean {
  const result = countSubtasksStmt.get(todoId);
  return result ? result.count > 0 : false;
}

export function isSubtask(todo: Todo): boolean {
  return todo.parent_id !== null;
}

export function canHaveChildren(todo: Todo): boolean {
  // Can only add children if not already a subtask (2 levels max)
  return todo.parent_id === null;
}

/**
 * Propagate tags from a parent task to all its children.
 * Call this after updating a parent task's tags.
 */
export function propagateTagsToChildren(parentId: number, tags: string): void {
  propagateTagsStmt.run(tags, parentId);
}

export function addSubtask(
  title: string,
  parentId: number,
  assignedTo: string | null = null
): Todo | null {
  if (!title.trim()) return null;
  // insertSubtaskStmt: title, assigned_to, parent_id, parent_id (for SELECT)
  const todo = insertSubtaskStmt.get(title.trim(), assignedTo, parentId, parentId);
  return todo ?? null;
}

export function setTodoParent(
  todoId: number,
  parentId: number | null
): Todo | null {
  const todo = setParentStmt.get(parentId, todoId);
  return todo ?? null;
}

export function orphanSubtasks(parentId: number): void {
  orphanSubtasksStmt.run(parentId);
}

export function getSubtaskProgress(parentId: number): {
  total: number;
  done: number;
  inProgress: number;
} {
  const subtasks = listSubtasks(parentId);
  return {
    total: subtasks.length,
    done: subtasks.filter((s) => s.state === "done").length,
    inProgress: subtasks.filter(
      (s) => s.state === "in_progress" || s.state === "review"
    ).length,
  };
}

// State ordering for parent computation (lower = earlier in workflow)
const STATE_ORDER: Record<TodoState, number> = {
  new: 0,
  ready: 1,
  in_progress: 2,
  review: 3,
  done: 4,
  archived: 5,
};

const STATE_BY_ORDER: TodoState[] = ["new", "ready", "in_progress", "review", "done", "archived"];

/**
 * Compute the state a parent should have based on its subtasks.
 * Parent state = minimum (slowest/earliest) state of all subtasks.
 * Returns null if no subtasks exist.
 */
export function computeParentState(parentId: number): TodoState | null {
  const subtasks = listSubtasks(parentId);
  if (subtasks.length === 0) return null;

  let minOrder = STATE_ORDER.done; // Start with highest
  for (const subtask of subtasks) {
    const order = STATE_ORDER[subtask.state] ?? 0;
    if (order < minOrder) {
      minOrder = order;
    }
  }
  return STATE_BY_ORDER[minOrder];
}

/**
 * Update a parent task's state to match its slowest subtask.
 * Called after subtask state changes.
 */
export function updateParentStateFromSubtasks(parentId: number): Todo | null {
  const parent = getTodoById(parentId);
  if (!parent) return null;

  const computedState = computeParentState(parentId);
  if (!computedState) return parent; // No subtasks, keep current state

  // Only update if state is different
  if (parent.state === computedState) return parent;

  // Update parent state directly (bypassing owner check since this is internal)
  const updated = db.query<Todo, [TodoState, TodoState, number]>(
    `UPDATE todos SET state = ?, done = (? = 'done'), updated_at = datetime('now')
     WHERE id = ? AND deleted = 0 RETURNING *`
  ).get(computedState, computedState, parentId);

  return updated ?? null;
}

/**
 * After changing a subtask's state, update its parent's state if needed.
 */
export function syncParentStateAfterSubtaskChange(subtaskId: number): Todo | null {
  const subtask = getTodoById(subtaskId);
  if (!subtask || !subtask.parent_id) return null;

  return updateParentStateFromSubtasks(subtask.parent_id);
}

export function upsertSummary({
  owner,
  summaryDate,
  dayAhead,
  weekAhead,
  suggestions,
}: {
  owner: string;
  summaryDate: string;
  dayAhead: string | null;
  weekAhead: string | null;
  suggestions: string | null;
}) {
  const summary = upsertSummaryStmt.get(owner, summaryDate, dayAhead, weekAhead, suggestions) as Summary | undefined;
  return summary ?? null;
}

export function getLatestSummaries(owner: string, today: string, weekStart: string, weekEnd: string) {
  const day = latestDaySummaryStmt.get(owner, today) as Summary | undefined;
  const week = latestWeekSummaryStmt.get(owner, weekStart, weekEnd) as Summary | undefined;
  return { day: day ?? null, week: week ?? null };
}

// Channel functions
export function listChannels() {
  return listChannelsStmt.all();
}

export function getChannel(id: number) {
  return getChannelByIdStmt.get(id) as Channel | undefined ?? null;
}

export function getChannelByName(name: string) {
  return getChannelByNameStmt.get(name) as Channel | undefined ?? null;
}

export function createChannel(
  name: string,
  displayName: string,
  description: string,
  creator: string,
  isPublic: boolean
) {
  return insertChannelStmt.get(name, displayName, description, creator, isPublic ? 1 : 0) as Channel | undefined ?? null;
}

export function createEncryptedChannel(
  name: string,
  displayName: string,
  description: string,
  creator: string,
  isPublic: boolean
) {
  return insertEncryptedChannelStmt.get(name, displayName, description, creator, isPublic ? 1 : 0) as Channel | undefined ?? null;
}

export function updateChannel(id: number, displayName: string, description: string, isPublic: boolean) {
  return updateChannelStmt.get(displayName, description, isPublic ? 1 : 0, id) as Channel | undefined ?? null;
}

export function deleteChannel(id: number) {
  deleteChannelStmt.run(id);
}

// Message functions
export function listMessages(channelId: number) {
  return listMessagesStmt.all(channelId);
}

export function listThreadMessages(rootId: number) {
  return listThreadMessagesStmt.all(rootId, rootId);
}

export function getMessage(id: number) {
  return getMessageByIdStmt.get(id) as Message | undefined ?? null;
}

export function createMessage(
  channelId: number,
  author: string,
  body: string,
  threadRootId: number | null,
  parentId: number | null,
  quotedMessageId: number | null
) {
  return insertMessageStmt.get(channelId, author, body, threadRootId, parentId, quotedMessageId) as Message | undefined ?? null;
}

export function createEncryptedMessage(
  channelId: number,
  author: string,
  encryptedBody: string,
  threadRootId: number | null,
  parentId: number | null,
  quotedMessageId: number | null,
  keyVersion: number
) {
  return insertEncryptedMessageStmt.get(channelId, author, encryptedBody, threadRootId, parentId, quotedMessageId, keyVersion) as Message | undefined ?? null;
}

export function deleteMessage(id: number): boolean {
  const result = deleteMessageStmt.run(id);
  return result.changes > 0;
}

// Reaction functions
export function toggleReaction(
  messageId: number,
  reactor: string,
  emoji: string
): { action: "add" | "remove"; reaction?: Reaction } {
  const existing = getReactionStmt.get(messageId, reactor, emoji) as Reaction | undefined;
  if (existing) {
    deleteReactionStmt.run(messageId, reactor, emoji);
    return { action: "remove" };
  }
  const reaction = insertReactionStmt.get(messageId, reactor, emoji) as Reaction | undefined;
  return { action: "add", reaction: reaction ?? undefined };
}

export function getMessageReactions(messageId: number): ReactionGroup[] {
  const reactions = listReactionsForMessageStmt.all(messageId);
  return groupReactions(reactions);
}

export function getMessagesReactions(messageIds: number[]): Map<number, ReactionGroup[]> {
  const result = new Map<number, ReactionGroup[]>();
  if (messageIds.length === 0) return result;

  // Batch query all reactions for these messages
  const placeholders = messageIds.map(() => "?").join(",");
  const stmt = db.query<Reaction>(
    `SELECT * FROM message_reactions WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
  );
  const allReactions = stmt.all(...messageIds);

  // Group by message_id first
  const byMessage = new Map<number, Reaction[]>();
  for (const r of allReactions) {
    const list = byMessage.get(r.message_id) || [];
    list.push(r);
    byMessage.set(r.message_id, list);
  }

  // Convert to ReactionGroup arrays
  for (const [msgId, reactions] of byMessage) {
    result.set(msgId, groupReactions(reactions));
  }

  return result;
}

function groupReactions(reactions: Reaction[]): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const existing = groups.get(r.emoji);
    if (existing) {
      existing.count++;
      existing.reactors.push(r.reactor);
    } else {
      groups.set(r.emoji, { emoji: r.emoji, count: 1, reactors: [r.reactor] });
    }
  }
  return Array.from(groups.values());
}

// Channel read state functions
export function getChannelReadState(npub: string, channelId: number) {
  return getReadStateStmt.get(npub, channelId) as ChannelReadState | undefined ?? null;
}

export function updateChannelReadState(npub: string, channelId: number, lastMessageId: number | null) {
  return upsertReadStateStmt.get(npub, channelId, lastMessageId) as ChannelReadState | undefined ?? null;
}

export function getUnreadCounts(npub: string): UnreadCount[] {
  // Parameters: author != npub (unread), author != npub (mention), mentioned_npub, crs.npub, owner_npub
  return getUnreadCountsStmt.all(npub, npub, npub, npub, npub);
}

export function getLatestMessageId(channelId: number): number | null {
  const result = db.query<{ max_id: number | null }>(
    "SELECT MAX(id) as max_id FROM messages WHERE channel_id = ?"
  ).get(channelId);
  return result?.max_id ?? null;
}

// User statements
const listUsersStmt = db.query<User>(
  "SELECT * FROM users ORDER BY updated_at DESC"
);
const getUserByNpubStmt = db.query<User>(
  "SELECT * FROM users WHERE npub = ?"
);
const getUserByPubkeyStmt = db.query<User>(
  "SELECT * FROM users WHERE pubkey = ?"
);
const upsertUserStmt = db.query<User>(
  `INSERT INTO users (npub, pubkey, display_name, name, about, picture, nip05, last_login, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(npub) DO UPDATE SET
     display_name = COALESCE(excluded.display_name, users.display_name),
     name = COALESCE(excluded.name, users.name),
     about = COALESCE(excluded.about, users.about),
     picture = COALESCE(excluded.picture, users.picture),
     nip05 = COALESCE(excluded.nip05, users.nip05),
     last_login = COALESCE(excluded.last_login, users.last_login),
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`
);

// User functions
export function listUsers() {
  return listUsersStmt.all();
}

export function getUserByNpub(npub: string) {
  return getUserByNpubStmt.get(npub) as User | undefined ?? null;
}

export function getUserByPubkey(pubkey: string) {
  return getUserByPubkeyStmt.get(pubkey) as User | undefined ?? null;
}

export function upsertUser(user: {
  npub: string;
  pubkey: string;
  displayName?: string | null;
  name?: string | null;
  about?: string | null;
  picture?: string | null;
  nip05?: string | null;
  lastLogin?: string | null;
}) {
  return upsertUserStmt.get(
    user.npub,
    user.pubkey,
    user.displayName ?? null,
    user.name ?? null,
    user.about ?? null,
    user.picture ?? null,
    user.nip05 ?? null,
    user.lastLogin ?? null
  ) as User | undefined ?? null;
}

// Group statements
const listGroupsStmt = db.query<Group>("SELECT * FROM groups ORDER BY name ASC");
const getGroupByIdStmt = db.query<Group>("SELECT * FROM groups WHERE id = ?");
const getGroupByNameStmt = db.query<Group>("SELECT * FROM groups WHERE name = ?");
const insertGroupStmt = db.query<Group>(
  `INSERT INTO groups (name, description, created_by) VALUES (?, ?, ?) RETURNING *`
);
const updateGroupStmt = db.query<Group>(
  `UPDATE groups SET name = ?, description = ? WHERE id = ? RETURNING *`
);
const deleteGroupStmt = db.query("DELETE FROM groups WHERE id = ?");

// Group member statements
const listGroupMembersStmt = db.query<GroupMember & { display_name: string | null; picture: string | null }>(
  `SELECT gm.*, u.display_name, u.picture FROM group_members gm
   LEFT JOIN users u ON gm.npub = u.npub
   WHERE gm.group_id = ? ORDER BY gm.added_at ASC`
);
const addGroupMemberStmt = db.query<GroupMember>(
  `INSERT OR IGNORE INTO group_members (group_id, npub) VALUES (?, ?) RETURNING *`
);
const removeGroupMemberStmt = db.query("DELETE FROM group_members WHERE group_id = ? AND npub = ?");
const getGroupsForNpubStmt = db.query<Group>(
  `SELECT g.* FROM groups g
   JOIN group_members gm ON g.id = gm.group_id
   WHERE gm.npub = ?`
);

// Channel group statements
const listChannelGroupsStmt = db.query<ChannelGroup & { name: string }>(
  `SELECT cg.*, g.name FROM channel_groups cg
   JOIN groups g ON cg.group_id = g.id
   WHERE cg.channel_id = ?`
);
const addChannelGroupStmt = db.query<ChannelGroup>(
  `INSERT OR IGNORE INTO channel_groups (channel_id, group_id) VALUES (?, ?) RETURNING *`
);
const removeChannelGroupStmt = db.query("DELETE FROM channel_groups WHERE channel_id = ? AND group_id = ?");

// Query for channels visible to a user (public OR user is in a group assigned to the channel)
// Excludes personal channels (owner_npub IS NOT NULL) and DM channels - those are fetched separately
const listVisibleChannelsStmt = db.query<Channel>(
  `SELECT DISTINCT c.* FROM channels c
   WHERE c.owner_npub IS NULL
   AND c.name NOT LIKE 'dm-%'
   AND (
     c.is_public = 1
     OR EXISTS (
       SELECT 1 FROM channel_groups cg
       JOIN group_members gm ON gm.group_id = cg.group_id
       WHERE cg.channel_id = c.id AND gm.npub = ?
     )
   )
   ORDER BY c.created_at ASC`
);

// Get personal channel for a user
const getPersonalChannelStmt = db.query<Channel>(
  `SELECT * FROM channels WHERE owner_npub = ? LIMIT 1`
);

// Create personal channel
const insertPersonalChannelStmt = db.query<Channel>(
  `INSERT INTO channels (name, display_name, description, creator, is_public, owner_npub)
   VALUES (?, 'Note to self', 'Your private notes', ?, 0, ?)
   RETURNING *`
);

// DM channel statements
// Find existing DM channel between two users
const findDmChannelStmt = db.query<Channel>(
  `SELECT c.* FROM channels c
   JOIN dm_participants dp1 ON dp1.channel_id = c.id AND dp1.npub = ?
   JOIN dm_participants dp2 ON dp2.channel_id = c.id AND dp2.npub = ?
   LIMIT 1`
);

// Get all DM channels for a user (with the other participant's npub)
const listDmChannelsStmt = db.query<Channel & { other_npub: string }>(
  `SELECT c.*, dp2.npub as other_npub
   FROM channels c
   JOIN dm_participants dp1 ON dp1.channel_id = c.id AND dp1.npub = ?
   JOIN dm_participants dp2 ON dp2.channel_id = c.id AND dp2.npub != ?
   ORDER BY c.created_at DESC`
);

// Create DM channel
const insertDmChannelStmt = db.query<Channel>(
  `INSERT INTO channels (name, display_name, description, creator, is_public)
   VALUES (?, ?, 'Direct message', ?, 0)
   RETURNING *`
);

// Add DM participant
const addDmParticipantStmt = db.query<DmParticipant>(
  `INSERT INTO dm_participants (channel_id, npub) VALUES (?, ?) RETURNING *`
);

// Get DM participants for a channel
const getDmParticipantsStmt = db.query<DmParticipant>(
  `SELECT * FROM dm_participants WHERE channel_id = ?`
);

// Check if user can access a specific private channel (includes DM check)
const canAccessChannelStmt = db.query<{ can_access: number }>(
  `SELECT 1 as can_access FROM channels c
   WHERE c.id = ? AND (
     c.is_public = 1
     OR c.owner_npub = ?
     OR EXISTS (
       SELECT 1 FROM dm_participants dp WHERE dp.channel_id = c.id AND dp.npub = ?
     )
     OR EXISTS (
       SELECT 1 FROM channel_groups cg
       JOIN group_members gm ON gm.group_id = cg.group_id
       WHERE cg.channel_id = c.id AND gm.npub = ?
     )
   )`
);

// Group functions
export function listGroups() {
  return listGroupsStmt.all();
}

export function getGroup(id: number) {
  return getGroupByIdStmt.get(id) as Group | undefined ?? null;
}

export function getGroupByName(name: string) {
  return getGroupByNameStmt.get(name) as Group | undefined ?? null;
}

export function createGroup(name: string, description: string, createdBy: string) {
  return insertGroupStmt.get(name, description, createdBy) as Group | undefined ?? null;
}

export function updateGroup(id: number, name: string, description: string) {
  return updateGroupStmt.get(name, description, id) as Group | undefined ?? null;
}

export function deleteGroup(id: number) {
  deleteGroupStmt.run(id);
}

// Group member functions
export function listGroupMembers(groupId: number) {
  return listGroupMembersStmt.all(groupId);
}

export function addGroupMember(groupId: number, npub: string) {
  return addGroupMemberStmt.get(groupId, npub) as GroupMember | undefined ?? null;
}

export function removeGroupMember(groupId: number, npub: string) {
  removeGroupMemberStmt.run(groupId, npub);
}

export function getGroupsForUser(npub: string) {
  return getGroupsForNpubStmt.all(npub);
}

// Channel group functions
export function listChannelGroups(channelId: number) {
  return listChannelGroupsStmt.all(channelId);
}

export function addChannelGroup(channelId: number, groupId: number) {
  return addChannelGroupStmt.get(channelId, groupId) as ChannelGroup | undefined ?? null;
}

export function removeChannelGroup(channelId: number, groupId: number) {
  removeChannelGroupStmt.run(channelId, groupId);
}

/**
 * Get all npubs who have access to a channel (via groups) but don't have encryption keys
 */
export function getChannelMembersWithoutKeys(channelId: number): string[] {
  // Get all unique npubs from assigned groups
  const groups = listChannelGroupsStmt.all(channelId);
  const memberNpubs = new Set<string>();

  for (const group of groups) {
    const members = listGroupMembersStmt.all(group.group_id);
    for (const member of members) {
      memberNpubs.add(member.npub);
    }
  }

  // Get npubs who already have keys
  const existingKeys = getChannelKeysStmt.all(channelId);
  const npubsWithKeys = new Set(existingKeys.map(k => {
    // Convert pubkey to npub for comparison (keys are stored with hex pubkey)
    // We need to check against the actual stored user_pubkey
    return k.user_pubkey;
  }));

  // Return npubs that don't have keys (need to convert npub to pubkey for comparison)
  // Actually, we store keys by pubkey (hex), but group members are stored by npub
  // We need to look up the user's pubkey from their npub
  const result: string[] = [];
  for (const npub of memberNpubs) {
    // Get user's pubkey from users table
    const user = getUserByNpub(npub);
    if (user && !npubsWithKeys.has(user.pubkey)) {
      result.push(npub);
    }
  }

  return result;
}

/**
 * Get encrypted channels that use a specific group
 */
export function getEncryptedChannelsForGroup(groupId: number): Channel[] {
  // This query gets channels where this group is assigned
  const stmt = db.query<Channel>(
    `SELECT c.* FROM channels c
     JOIN channel_groups cg ON c.id = cg.channel_id
     WHERE cg.group_id = ? AND c.encrypted = 1`
  );
  return stmt.all(groupId);
}

/**
 * Check if a user still has access to a channel through any group
 * (used to determine if their key should be revoked)
 */
export function userHasChannelAccessViaGroups(channelId: number, npub: string): boolean {
  const channelGroups = listChannelGroupsStmt.all(channelId);
  for (const cg of channelGroups) {
    const members = listGroupMembersStmt.all(cg.group_id);
    if (members.some(m => m.npub === npub)) {
      return true;
    }
  }
  return false;
}

/**
 * Revoke encryption keys for a user on a channel
 */
export function revokeUserChannelKeys(userPubkey: string, channelId: number) {
  deleteUserChannelKeysStmt.run(userPubkey, channelId);
}

/**
 * Handle key revocation when a member is removed from a group
 * Removes keys for encrypted channels they no longer have access to
 */
export function handleGroupMemberRemoval(groupId: number, npub: string) {
  const user = getUserByNpub(npub);
  if (!user) return;

  // Get all encrypted channels that use this group
  const encryptedChannels = getEncryptedChannelsForGroup(groupId);

  for (const channel of encryptedChannels) {
    // Check if user still has access via other groups
    if (!userHasChannelAccessViaGroups(channel.id, npub)) {
      // User no longer has access - revoke their key
      deleteUserChannelKeysStmt.run(user.pubkey, channel.id);
      console.log(`[Encryption] Revoked key for ${npub} on channel ${channel.id}`);
    }
  }
}

/**
 * Handle key revocation when a group is removed from a channel
 */
export function handleGroupRemovedFromChannel(channelId: number, groupId: number) {
  const channel = getChannelByIdStmt.get(channelId) as Channel | undefined;
  if (!channel || channel.encrypted !== 1) return;

  // Get all members of the removed group
  const members = listGroupMembersStmt.all(groupId);

  for (const member of members) {
    const user = getUserByNpub(member.npub);
    if (!user) continue;

    // Check if user still has access via other groups
    if (!userHasChannelAccessViaGroups(channelId, member.npub)) {
      // User no longer has access - revoke their key
      deleteUserChannelKeysStmt.run(user.pubkey, channelId);
      console.log(`[Encryption] Revoked key for ${member.npub} on channel ${channelId}`);
    }
  }
}

// Channel visibility functions
export function listVisibleChannels(npub: string) {
  return listVisibleChannelsStmt.all(npub);
}

export function listAllChannels() {
  return listChannelsStmt.all();
}

export function canUserAccessChannel(channelId: number, npub: string): boolean {
  const result = canAccessChannelStmt.get(channelId, npub, npub, npub);
  return result !== undefined;
}

// Personal channel functions
export function getPersonalChannel(npub: string) {
  return getPersonalChannelStmt.get(npub) as Channel | undefined ?? null;
}

export function getOrCreatePersonalChannel(npub: string) {
  let channel = getPersonalChannelStmt.get(npub) as Channel | undefined;
  if (!channel) {
    // Create a unique name using a short hash of the npub
    const shortHash = npub.slice(-8);
    const name = `notes-${shortHash}`;
    channel = insertPersonalChannelStmt.get(name, npub, npub) as Channel | undefined;
  }
  return channel ?? null;
}

// DM channel functions
export function listDmChannels(npub: string) {
  return listDmChannelsStmt.all(npub, npub);
}

export function findDmChannel(npub1: string, npub2: string) {
  return findDmChannelStmt.get(npub1, npub2) as Channel | undefined ?? null;
}

export function getDmParticipants(channelId: number) {
  return getDmParticipantsStmt.all(channelId);
}

export function getOrCreateDmChannel(creatorNpub: string, otherNpub: string, displayName: string) {
  // Check if DM already exists
  let channel = findDmChannelStmt.get(creatorNpub, otherNpub) as Channel | undefined;
  if (channel) {
    return channel;
  }

  // Create new DM channel
  const shortHash1 = creatorNpub.slice(-6);
  const shortHash2 = otherNpub.slice(-6);
  const name = `dm-${shortHash1}-${shortHash2}`;

  channel = insertDmChannelStmt.get(name, displayName, creatorNpub) as Channel | undefined;
  if (channel) {
    // Add both participants
    addDmParticipantStmt.run(channel.id, creatorNpub);
    addDmParticipantStmt.run(channel.id, otherNpub);
  }

  return channel ?? null;
}

// VAPID statements
const getVapidConfigStmt = db.query<VapidConfig>(
  "SELECT * FROM vapid_config WHERE id = 1"
);
const insertVapidConfigStmt = db.query<VapidConfig>(
  `INSERT INTO vapid_config (id, public_key, private_key, contact_email)
   VALUES (1, ?, ?, ?)
   RETURNING *`
);

// Push subscription statements
const getPushSubByEndpointStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE endpoint = ?"
);
const getPushSubsForNpubStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE npub = ? AND is_active = 1"
);
const getActivePushSubsStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE is_active = 1"
);
const getActivePushSubsByFreqStmt = db.query<PushSubscription>(
  "SELECT * FROM push_subscriptions WHERE is_active = 1 AND frequency = ?"
);
const upsertPushSubStmt = db.query<PushSubscription>(
  `INSERT INTO push_subscriptions (npub, endpoint, p256dh_key, auth_key, frequency)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(npub, endpoint) DO UPDATE SET
     p256dh_key = excluded.p256dh_key,
     auth_key = excluded.auth_key,
     frequency = excluded.frequency,
     is_active = 1
   RETURNING *`
);
const updatePushSubFreqStmt = db.query<PushSubscription>(
  `UPDATE push_subscriptions SET frequency = ? WHERE npub = ? AND endpoint = ? RETURNING *`
);
const deactivatePushSubStmt = db.query(
  "UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?"
);
const updatePushSubLastSentStmt = db.query(
  "UPDATE push_subscriptions SET last_sent_at = CURRENT_TIMESTAMP WHERE id = ?"
);

// VAPID functions
export function getVapidConfig() {
  return getVapidConfigStmt.get() as VapidConfig | undefined ?? null;
}

export function createVapidConfig(publicKey: string, privateKey: string, contactEmail: string) {
  return insertVapidConfigStmt.get(publicKey, privateKey, contactEmail) as VapidConfig | undefined ?? null;
}

// Push subscription functions
export function getPushSubscriptionByEndpoint(endpoint: string) {
  return getPushSubByEndpointStmt.get(endpoint) as PushSubscription | undefined ?? null;
}

export function getPushSubscriptionsForUser(npub: string) {
  return getPushSubsForNpubStmt.all(npub);
}

export function getActivePushSubscriptions(frequency?: NotificationFrequency) {
  if (frequency) {
    return getActivePushSubsByFreqStmt.all(frequency);
  }
  return getActivePushSubsStmt.all();
}

export function upsertPushSubscription(
  npub: string,
  endpoint: string,
  p256dhKey: string,
  authKey: string,
  frequency: NotificationFrequency
) {
  return upsertPushSubStmt.get(npub, endpoint, p256dhKey, authKey, frequency) as PushSubscription | undefined ?? null;
}

export function updatePushSubscriptionFrequency(npub: string, endpoint: string, frequency: NotificationFrequency) {
  return updatePushSubFreqStmt.get(frequency, npub, endpoint) as PushSubscription | undefined ?? null;
}

export function deactivatePushSubscription(endpoint: string) {
  deactivatePushSubStmt.run(endpoint);
}

export function markPushSubscriptionSent(id: number) {
  updatePushSubLastSentStmt.run(id);
}

// Task-thread linking statements
const linkThreadToTaskStmt = db.query<TaskThread>(
  `INSERT INTO task_threads (todo_id, message_id, linked_by)
   VALUES (?, ?, ?)
   ON CONFLICT(todo_id, message_id) DO NOTHING
   RETURNING *`
);
const unlinkThreadFromTaskStmt = db.query(
  "DELETE FROM task_threads WHERE todo_id = ? AND message_id = ?"
);
const getThreadsForTaskStmt = db.query<TaskThread & { channel_id: number; body: string; author: string; channel_name: string }>(
  `SELECT tt.*, m.channel_id, m.body, m.author, c.name as channel_name
   FROM task_threads tt
   JOIN messages m ON tt.message_id = m.id
   JOIN channels c ON m.channel_id = c.id
   WHERE tt.todo_id = ?
   ORDER BY tt.linked_at DESC`
);
const getTasksForThreadStmt = db.query<TaskThread & { title: string; state: string; priority: string }>(
  `SELECT tt.*, t.title, t.state, t.priority
   FROM task_threads tt
   JOIN todos t ON tt.todo_id = t.id
   WHERE tt.message_id = ? AND t.deleted = 0
   ORDER BY tt.linked_at DESC`
);
const getThreadLinkCountStmt = db.query<{ count: number }>(
  "SELECT COUNT(*) as count FROM task_threads WHERE todo_id = ?"
);
const getTaskThreadLinkStmt = db.query<TaskThread>(
  "SELECT * FROM task_threads WHERE todo_id = ? AND message_id = ?"
);

// Task-thread linking functions
export function linkThreadToTask(todoId: number, messageId: number, linkedBy: string) {
  return linkThreadToTaskStmt.get(todoId, messageId, linkedBy) as TaskThread | undefined ?? null;
}

export function unlinkThreadFromTask(todoId: number, messageId: number) {
  unlinkThreadFromTaskStmt.run(todoId, messageId);
}

export function getThreadsForTask(todoId: number) {
  return getThreadsForTaskStmt.all(todoId);
}

export function getTasksForThread(messageId: number) {
  return getTasksForThreadStmt.all(messageId);
}

export function getThreadLinkCount(todoId: number): number {
  const result = getThreadLinkCountStmt.get(todoId);
  return result?.count ?? 0;
}

export function getTaskThreadLink(todoId: number, messageId: number) {
  return getTaskThreadLinkStmt.get(todoId, messageId) as TaskThread | undefined ?? null;
}

// Pinned message statements
const pinMessageStmt = db.query<PinnedMessage>(
  `INSERT INTO pinned_messages (channel_id, message_id, pinned_by)
   VALUES (?, ?, ?)
   ON CONFLICT(channel_id, message_id) DO NOTHING
   RETURNING *`
);
const unpinMessageStmt = db.query(
  "DELETE FROM pinned_messages WHERE channel_id = ? AND message_id = ?"
);
const getPinnedMessagesStmt = db.query<PinnedMessage & { body: string; author: string; thread_root_id: number | null; created_at: string }>(
  `SELECT pm.*, m.body, m.author, m.thread_root_id, m.created_at
   FROM pinned_messages pm
   JOIN messages m ON pm.message_id = m.id
   WHERE pm.channel_id = ?
   ORDER BY pm.pinned_at DESC`
);
const isPinnedStmt = db.query<{ count: number }>(
  "SELECT COUNT(*) as count FROM pinned_messages WHERE channel_id = ? AND message_id = ?"
);

// Pinned message functions
export function pinMessage(channelId: number, messageId: number, pinnedBy: string): PinnedMessage | null {
  return pinMessageStmt.get(channelId, messageId, pinnedBy) as PinnedMessage | undefined ?? null;
}

export function unpinMessage(channelId: number, messageId: number): boolean {
  const result = unpinMessageStmt.run(channelId, messageId);
  return result.changes > 0;
}

export function getPinnedMessages(channelId: number) {
  return getPinnedMessagesStmt.all(channelId);
}

export function isMessagePinned(channelId: number, messageId: number): boolean {
  const result = isPinnedStmt.get(channelId, messageId);
  return (result?.count ?? 0) > 0;
}

// Task-CRM linking statements
type TaskWithCrmLink = Todo & { link_id: number; linked_at: string };

const linkTaskToCrmStmt = db.query<TaskCrmLink>(
  `INSERT INTO task_crm_links (todo_id, contact_id, company_id, activity_id, opportunity_id, linked_by)
   VALUES (?, ?, ?, ?, ?, ?)
   RETURNING *`
);
const unlinkTaskFromCrmStmt = db.query(
  "DELETE FROM task_crm_links WHERE id = ?"
);
const getCrmLinksForTaskStmt = db.query<TaskCrmLink>(
  "SELECT * FROM task_crm_links WHERE todo_id = ? ORDER BY linked_at DESC"
);
const getTasksForContactStmt = db.query<TaskWithCrmLink>(
  `SELECT t.*, tcl.id as link_id, tcl.linked_at
   FROM todos t
   JOIN task_crm_links tcl ON t.id = tcl.todo_id
   WHERE tcl.contact_id = ?
     AND t.deleted = 0
     AND (t.state != 'done' OR datetime(t.created_at) > datetime('now', '-21 days'))
   ORDER BY t.state = 'done', t.created_at DESC`
);
const getTasksForCompanyStmt = db.query<TaskWithCrmLink>(
  `SELECT t.*, tcl.id as link_id, tcl.linked_at
   FROM todos t
   JOIN task_crm_links tcl ON t.id = tcl.todo_id
   WHERE tcl.company_id = ?
     AND t.deleted = 0
     AND (t.state != 'done' OR datetime(t.created_at) > datetime('now', '-21 days'))
   ORDER BY t.state = 'done', t.created_at DESC`
);
const getTasksForActivityStmt = db.query<TaskWithCrmLink>(
  `SELECT t.*, tcl.id as link_id, tcl.linked_at
   FROM todos t
   JOIN task_crm_links tcl ON t.id = tcl.todo_id
   WHERE tcl.activity_id = ?
     AND t.deleted = 0
     AND (t.state != 'done' OR datetime(t.created_at) > datetime('now', '-21 days'))
   ORDER BY t.state = 'done', t.created_at DESC`
);
const getTasksForOpportunityStmt = db.query<TaskWithCrmLink>(
  `SELECT t.*, tcl.id as link_id, tcl.linked_at
   FROM todos t
   JOIN task_crm_links tcl ON t.id = tcl.todo_id
   WHERE tcl.opportunity_id = ?
     AND t.deleted = 0
     AND (t.state != 'done' OR datetime(t.created_at) > datetime('now', '-21 days'))
   ORDER BY t.state = 'done', t.created_at DESC`
);

// Task-CRM linking functions
export function linkTaskToCrm(
  todoId: number,
  entities: { contactId?: number; companyId?: number; activityId?: number; opportunityId?: number },
  linkedBy: string
) {
  return linkTaskToCrmStmt.get(
    todoId,
    entities.contactId ?? null,
    entities.companyId ?? null,
    entities.activityId ?? null,
    entities.opportunityId ?? null,
    linkedBy
  ) as TaskCrmLink | undefined ?? null;
}

export function unlinkTaskFromCrm(linkId: number) {
  unlinkTaskFromCrmStmt.run(linkId);
}

export function getCrmLinksForTask(todoId: number) {
  return getCrmLinksForTaskStmt.all(todoId);
}

// Get CRM links with entity details
const getCrmLinksWithDetailsStmt = db.query<TaskCrmLink & {
  contact_name: string | null;
  company_name: string | null;
  activity_subject: string | null;
  activity_type: string | null;
  opportunity_title: string | null;
}>(
  `SELECT tcl.*,
    con.name as contact_name,
    com.name as company_name,
    act.subject as activity_subject,
    act.type as activity_type,
    opp.title as opportunity_title
   FROM task_crm_links tcl
   LEFT JOIN crm_contacts con ON tcl.contact_id = con.id
   LEFT JOIN crm_companies com ON tcl.company_id = com.id
   LEFT JOIN crm_activities act ON tcl.activity_id = act.id
   LEFT JOIN crm_opportunities opp ON tcl.opportunity_id = opp.id
   WHERE tcl.todo_id = ?
   ORDER BY tcl.linked_at DESC`
);

export function getCrmLinksWithDetails(todoId: number) {
  return getCrmLinksWithDetailsStmt.all(todoId);
}

export function getTasksForContact(contactId: number) {
  return getTasksForContactStmt.all(contactId);
}

export function getTasksForCompany(companyId: number) {
  return getTasksForCompanyStmt.all(companyId);
}

export function getTasksForActivity(activityId: number) {
  return getTasksForActivityStmt.all(activityId);
}

export function getTasksForOpportunity(opportunityId: number) {
  return getTasksForOpportunityStmt.all(opportunityId);
}

// Get all outstanding tasks linked to CRM entities
type CrmLinkedTask = Todo & {
  link_id: number;
  contact_id: number | null;
  company_id: number | null;
  activity_id: number | null;
  opportunity_id: number | null;
  contact_name: string | null;
  company_name: string | null;
  opportunity_title: string | null;
};

const getOutstandingCrmTasksStmt = db.query<CrmLinkedTask>(
  `SELECT DISTINCT t.*, tcl.id as link_id,
    tcl.contact_id, tcl.company_id, tcl.activity_id, tcl.opportunity_id,
    con.name as contact_name,
    com.name as company_name,
    opp.title as opportunity_title
   FROM todos t
   JOIN task_crm_links tcl ON t.id = tcl.todo_id
   LEFT JOIN crm_contacts con ON tcl.contact_id = con.id
   LEFT JOIN crm_companies com ON tcl.company_id = com.id
   LEFT JOIN crm_opportunities opp ON tcl.opportunity_id = opp.id
   WHERE t.deleted = 0
     AND t.state != 'done'
   ORDER BY
     CASE t.priority
       WHEN 'rock' THEN 1
       WHEN 'pebble' THEN 2
       WHEN 'sand' THEN 3
     END,
     t.created_at DESC
   LIMIT 20`
);

export function getOutstandingCrmTasks() {
  return getOutstandingCrmTasksStmt.all();
}

// App settings statements
const getSettingStmt = db.query<AppSetting>(
  "SELECT * FROM app_settings WHERE key = ?"
);
const setSettingStmt = db.query<AppSetting>(
  `INSERT INTO app_settings (key, value, updated_at)
   VALUES (?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET
     value = excluded.value,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`
);
const deleteSettingStmt = db.query("DELETE FROM app_settings WHERE key = ?");
const listSettingsStmt = db.query<AppSetting>(
  "SELECT * FROM app_settings ORDER BY key"
);
const listSettingsByPrefixStmt = db.query<AppSetting>(
  "SELECT * FROM app_settings WHERE key LIKE ? ORDER BY key"
);

// App settings functions
export function getSetting(key: string): string | null {
  const setting = getSettingStmt.get(key) as AppSetting | undefined;
  return setting?.value ?? null;
}

export function setSetting(key: string, value: string): AppSetting | null {
  return setSettingStmt.get(key, value) as AppSetting | undefined ?? null;
}

export function deleteSetting(key: string): void {
  deleteSettingStmt.run(key);
}

export function listSettings(): AppSetting[] {
  return listSettingsStmt.all();
}

export function listSettingsByPrefix(prefix: string): AppSetting[] {
  return listSettingsByPrefixStmt.all(`${prefix}%`);
}

// Wingman cost tracking statements
const insertWingmanCostStmt = db.query<WingmanCost>(
  `INSERT INTO wingman_costs (npub, model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
   VALUES (?, ?, ?, ?, ?, ?)
   RETURNING *`
);
const listWingmanCostsStmt = db.query<WingmanCost>(
  "SELECT * FROM wingman_costs ORDER BY created_at DESC LIMIT ?"
);
const listWingmanCostsByNpubStmt = db.query<WingmanCost>(
  "SELECT * FROM wingman_costs WHERE npub = ? ORDER BY created_at DESC LIMIT ?"
);
const getWingmanCostSummaryStmt = db.query<{ npub: string; total_cost: number; total_tokens: number; request_count: number }>(
  `SELECT npub, SUM(cost_usd) as total_cost, SUM(total_tokens) as total_tokens, COUNT(*) as request_count
   FROM wingman_costs
   GROUP BY npub
   ORDER BY total_cost DESC`
);
const getWingmanTotalCostStmt = db.query<{ total_cost: number; total_tokens: number; request_count: number }>(
  `SELECT SUM(cost_usd) as total_cost, SUM(total_tokens) as total_tokens, COUNT(*) as request_count
   FROM wingman_costs`
);

// Wingman cost tracking functions
export function recordWingmanCost(
  npub: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  costUsd: number
) {
  return insertWingmanCostStmt.get(npub, model, promptTokens, completionTokens, totalTokens, costUsd) as WingmanCost | undefined ?? null;
}

export function listWingmanCosts(limit: number = 100) {
  return listWingmanCostsStmt.all(limit);
}

export function listWingmanCostsByNpub(npub: string, limit: number = 100) {
  return listWingmanCostsByNpubStmt.all(npub, limit);
}

export function getWingmanCostSummary() {
  return getWingmanCostSummaryStmt.all();
}

export function getWingmanTotalCost() {
  return getWingmanTotalCostStmt.get() ?? { total_cost: 0, total_tokens: 0, request_count: 0 };
}

// User channel key statements (E2E encryption)
const getUserChannelKeyStmt = db.query<UserChannelKey>(
  `SELECT * FROM user_channel_keys
   WHERE user_pubkey = ? AND channel_id = ?
   ORDER BY key_version DESC
   LIMIT 1`
);
const getUserChannelKeyByVersionStmt = db.query<UserChannelKey>(
  `SELECT * FROM user_channel_keys
   WHERE user_pubkey = ? AND channel_id = ? AND key_version = ?`
);
const getChannelKeysStmt = db.query<UserChannelKey>(
  `SELECT * FROM user_channel_keys WHERE channel_id = ? ORDER BY key_version DESC`
);
const getLatestKeyVersionStmt = db.query<{ max_version: number }>(
  `SELECT MAX(key_version) as max_version FROM user_channel_keys WHERE channel_id = ?`
);
const insertUserChannelKeyStmt = db.query<UserChannelKey>(
  `INSERT INTO user_channel_keys (user_pubkey, channel_id, encrypted_key, key_version)
   VALUES (?, ?, ?, ?)
   RETURNING *`
);
const deleteUserChannelKeysStmt = db.query(
  `DELETE FROM user_channel_keys WHERE user_pubkey = ? AND channel_id = ?`
);
const setChannelEncryptedStmt = db.query<Channel>(
  `UPDATE channels SET encrypted = 1, encryption_enabled_at = CURRENT_TIMESTAMP
   WHERE id = ? RETURNING *`
);

// User channel key functions
export function getUserChannelKey(userPubkey: string, channelId: number) {
  return getUserChannelKeyStmt.get(userPubkey, channelId) as UserChannelKey | undefined ?? null;
}

export function getUserChannelKeyByVersion(userPubkey: string, channelId: number, keyVersion: number) {
  return getUserChannelKeyByVersionStmt.get(userPubkey, channelId, keyVersion) as UserChannelKey | undefined ?? null;
}

export function getChannelKeys(channelId: number) {
  return getChannelKeysStmt.all(channelId);
}

export function getLatestKeyVersion(channelId: number): number {
  const result = getLatestKeyVersionStmt.get(channelId);
  return result?.max_version ?? 0;
}

export function storeUserChannelKey(
  userPubkey: string,
  channelId: number,
  encryptedKey: string,
  keyVersion: number
) {
  return insertUserChannelKeyStmt.get(userPubkey, channelId, encryptedKey, keyVersion) as UserChannelKey | undefined ?? null;
}

export function deleteUserChannelKeys(userPubkey: string, channelId: number) {
  deleteUserChannelKeysStmt.run(userPubkey, channelId);
}

export function setChannelEncrypted(channelId: number) {
  return setChannelEncryptedStmt.get(channelId) as Channel | undefined ?? null;
}

// ============================================================
// Community Key Functions
// ============================================================

const getCommunityKeyStmt = db.query<CommunityKey>(
  `SELECT * FROM community_keys WHERE user_pubkey = ?`
);
const updateCommunityKeyStmt = db.query<CommunityKey>(
  `INSERT OR REPLACE INTO community_keys (user_pubkey, encrypted_key, created_at)
   VALUES (?, ?, CURRENT_TIMESTAMP) RETURNING *`
);
const listCommunityKeysStmt = db.query<CommunityKey>(
  `SELECT * FROM community_keys`
);
const countCommunityKeysStmt = db.query<{ count: number }>(
  `SELECT COUNT(*) as count FROM community_keys`
);

export function getCommunityKey(userPubkey: string) {
  return getCommunityKeyStmt.get(userPubkey) as CommunityKey | undefined ?? null;
}

export function storeCommunityKey(userPubkey: string, encryptedKey: string) {
  return updateCommunityKeyStmt.get(userPubkey, encryptedKey) as CommunityKey | undefined ?? null;
}

export function listAllCommunityKeys() {
  return listCommunityKeysStmt.all();
}

export function countCommunityKeys(): number {
  const result = countCommunityKeysStmt.get();
  return result?.count ?? 0;
}

export function storeCommunityKeysBatch(keys: Array<{ userPubkey: string; encryptedKey: string }>) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO community_keys (user_pubkey, encrypted_key, created_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`
  );
  const transaction = db.transaction((keyList: typeof keys) => {
    for (const k of keyList) {
      stmt.run(k.userPubkey, k.encryptedKey);
    }
  });
  transaction(keys);
}

// ============================================================
// Community State Functions
// ============================================================

const getCommunityStateStmt = db.query<CommunityState>(
  `SELECT * FROM community_state WHERE key = ?`
);
const setCommunityStateStmt = db.query<CommunityState>(
  `INSERT OR REPLACE INTO community_state (key, value, updated_at)
   VALUES (?, ?, CURRENT_TIMESTAMP) RETURNING *`
);

export function getCommunityState(key: string): string | null {
  const result = getCommunityStateStmt.get(key);
  return result?.value ?? null;
}

export function setCommunityState(key: string, value: string) {
  return setCommunityStateStmt.get(key, value);
}

export function isCommunityBootstrapped(): boolean {
  return getCommunityState("bootstrapped") === "1";
}

export function isMessageMigrationComplete(): boolean {
  return getCommunityState("message_migration_complete") === "1";
}

// ============================================================
// Invite Code Functions
// ============================================================

const getInviteByHashStmt = db.query<InviteCode>(
  `SELECT * FROM invite_codes WHERE code_hash = ?`
);
const insertInviteCodeStmt = db.query<InviteCode>(
  `INSERT INTO invite_codes (code_hash, encrypted_key, single_use, created_by, expires_at)
   VALUES (?, ?, ?, ?, ?) RETURNING *`
);
const incrementRedeemCountStmt = db.query(
  `UPDATE invite_codes SET redeemed_count = redeemed_count + 1 WHERE id = ?`
);
const listActiveInvitesStmt = db.query<InviteCode>(
  `SELECT * FROM invite_codes WHERE expires_at > unixepoch() ORDER BY created_at DESC`
);
const listInvitesByCreatorStmt = db.query<InviteCode>(
  `SELECT * FROM invite_codes WHERE created_by = ? ORDER BY created_at DESC`
);
const deleteInviteCodeStmt = db.query(
  `DELETE FROM invite_codes WHERE id = ?`
);
const insertRedemptionStmt = db.query<InviteRedemption>(
  `INSERT INTO invite_redemptions (invite_id, user_npub) VALUES (?, ?) RETURNING *`
);
const getRedemptionStmt = db.query<InviteRedemption>(
  `SELECT * FROM invite_redemptions WHERE invite_id = ? AND user_npub = ?`
);

export function getInviteByHash(codeHash: string) {
  return getInviteByHashStmt.get(codeHash) as InviteCode | undefined ?? null;
}

export function createInviteCode(
  codeHash: string,
  encryptedKey: string,
  singleUse: boolean,
  createdBy: string,
  expiresAt: number
) {
  return insertInviteCodeStmt.get(
    codeHash,
    encryptedKey,
    singleUse ? 1 : 0,
    createdBy,
    expiresAt
  ) as InviteCode | undefined ?? null;
}

export function listActiveInvites() {
  return listActiveInvitesStmt.all();
}

export function listInvitesByCreator(npub: string) {
  return listInvitesByCreatorStmt.all(npub);
}

export function deleteInviteCode(id: number) {
  deleteInviteCodeStmt.run(id);
}

export function redeemInvite(inviteId: number, userNpub: string): boolean {
  const invite = db.query<InviteCode>(`SELECT * FROM invite_codes WHERE id = ?`).get(inviteId);
  if (!invite) return false;

  // Check expiry
  if (invite.expires_at < Math.floor(Date.now() / 1000)) {
    return false;
  }

  // Check single-use
  if (invite.single_use === 1 && invite.redeemed_count > 0) {
    return false;
  }

  // Check if already redeemed by this user
  const existing = getRedemptionStmt.get(inviteId, userNpub);
  if (existing) {
    return true; // Already redeemed, that's ok
  }

  // Record redemption
  insertRedemptionStmt.get(inviteId, userNpub);
  incrementRedeemCountStmt.run(inviteId);

  return true;
}

export function hasUserRedeemedInvite(inviteId: number, userNpub: string): boolean {
  const result = getRedemptionStmt.get(inviteId, userNpub);
  return !!result;
}

// ============================================================
// User Onboarding Functions
// ============================================================

const setUserOnboardedStmt = db.query(
  `UPDATE users SET onboarded = 1, onboarded_at = unixepoch() WHERE npub = ?`
);
const isUserOnboardedStmt = db.query<{ onboarded: number }>(
  `SELECT onboarded FROM users WHERE npub = ?`
);
const listOnboardedUsersStmt = db.query<User>(
  `SELECT * FROM users WHERE onboarded = 1`
);
const listNonOnboardedUsersStmt = db.query<User>(
  `SELECT * FROM users WHERE onboarded = 0 OR onboarded IS NULL`
);

export function setUserOnboarded(npub: string) {
  setUserOnboardedStmt.run(npub);
}

export function isUserOnboarded(npub: string): boolean {
  const result = isUserOnboardedStmt.get(npub);
  return result?.onboarded === 1;
}

export function listOnboardedUsers() {
  return listOnboardedUsersStmt.all();
}

export function listNonOnboardedUsers() {
  return listNonOnboardedUsersStmt.all();
}

// ============================================================
// Message Migration Functions
// ============================================================

const getUnencryptedPublicMessagesStmt = db.query<Message>(
  `SELECT m.* FROM messages m
   JOIN channels c ON m.channel_id = c.id
   WHERE c.is_public = 1 AND c.owner_npub IS NULL AND m.encrypted = 0
   ORDER BY m.id ASC
   LIMIT ?`
);
const getUnencryptedPublicMessagesAfterStmt = db.query<Message>(
  `SELECT m.* FROM messages m
   JOIN channels c ON m.channel_id = c.id
   WHERE c.is_public = 1 AND c.owner_npub IS NULL AND m.encrypted = 0 AND m.id > ?
   ORDER BY m.id ASC
   LIMIT ?`
);
const countUnencryptedPublicMessagesStmt = db.query<{ count: number }>(
  `SELECT COUNT(*) as count FROM messages m
   JOIN channels c ON m.channel_id = c.id
   WHERE c.is_public = 1 AND c.owner_npub IS NULL AND m.encrypted = 0`
);
const updateMessageEncryptedStmt = db.query(
  `UPDATE messages SET body = ?, encrypted = 1, key_version = ? WHERE id = ?`
);

export function getUnencryptedPublicMessages(limit: number, afterId?: number) {
  if (afterId) {
    return getUnencryptedPublicMessagesAfterStmt.all(afterId, limit);
  }
  return getUnencryptedPublicMessagesStmt.all(limit);
}

export function countUnencryptedPublicMessages(): number {
  const result = countUnencryptedPublicMessagesStmt.get();
  return result?.count ?? 0;
}

export function updateMessageToEncrypted(messageId: number, encryptedBody: string, keyVersion: number) {
  updateMessageEncryptedStmt.run(encryptedBody, keyVersion, messageId);
}

export function updateMessagesToEncryptedBatch(
  messages: Array<{ id: number; body: string; keyVersion: number }>
) {
  const stmt = db.prepare(`UPDATE messages SET body = ?, encrypted = 1, key_version = ? WHERE id = ?`);
  const transaction = db.transaction((msgList: typeof messages) => {
    for (const msg of msgList) {
      stmt.run(msg.body, msg.keyVersion, msg.id);
    }
  });
  transaction(messages);
}

// CRM Companies statements
const listCrmCompaniesStmt = db.query<CrmCompany>(
  "SELECT * FROM crm_companies WHERE deleted = 0 ORDER BY name ASC"
);
const getCrmCompanyByIdStmt = db.query<CrmCompany>(
  "SELECT * FROM crm_companies WHERE id = ? AND deleted = 0"
);
const insertCrmCompanyStmt = db.query<CrmCompany>(
  `INSERT INTO crm_companies (name, website, industry, notes, created_by)
   VALUES (?, ?, ?, ?, ?)
   RETURNING *`
);
const updateCrmCompanyStmt = db.query<CrmCompany>(
  `UPDATE crm_companies
   SET name = ?, website = ?, industry = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND deleted = 0
   RETURNING *`
);
const deleteCrmCompanyStmt = db.query(
  "UPDATE crm_companies SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
);

// CRM Contacts statements
const listCrmContactsStmt = db.query<CrmContact & { company_name: string | null }>(
  `SELECT c.*, co.name as company_name
   FROM crm_contacts c
   LEFT JOIN crm_companies co ON c.company_id = co.id AND co.deleted = 0
   WHERE c.deleted = 0
   ORDER BY c.name ASC`
);
const listCrmContactsByCompanyStmt = db.query<CrmContact>(
  "SELECT * FROM crm_contacts WHERE company_id = ? AND deleted = 0 ORDER BY name ASC"
);
const getCrmContactByIdStmt = db.query<CrmContact & { company_name: string | null }>(
  `SELECT c.*, co.name as company_name
   FROM crm_contacts c
   LEFT JOIN crm_companies co ON c.company_id = co.id AND co.deleted = 0
   WHERE c.id = ? AND c.deleted = 0`
);
const insertCrmContactStmt = db.query<CrmContact>(
  `INSERT INTO crm_contacts (company_id, name, email, phone, npub, twitter, linkedin, notes, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING *`
);
const updateCrmContactStmt = db.query<CrmContact>(
  `UPDATE crm_contacts
   SET company_id = ?, name = ?, email = ?, phone = ?, npub = ?, twitter = ?, linkedin = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND deleted = 0
   RETURNING *`
);
const deleteCrmContactStmt = db.query(
  "UPDATE crm_contacts SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
);

// CRM Opportunities statements
const listCrmOpportunitiesStmt = db.query<CrmOpportunity & { company_name: string | null; contact_name: string | null }>(
  `SELECT o.*, co.name as company_name, c.name as contact_name
   FROM crm_opportunities o
   LEFT JOIN crm_companies co ON o.company_id = co.id AND co.deleted = 0
   LEFT JOIN crm_contacts c ON o.contact_id = c.id AND c.deleted = 0
   WHERE o.deleted = 0
   ORDER BY o.created_at DESC`
);
const listCrmOpportunitiesByStageStmt = db.query<CrmOpportunity & { company_name: string | null; contact_name: string | null }>(
  `SELECT o.*, co.name as company_name, c.name as contact_name
   FROM crm_opportunities o
   LEFT JOIN crm_companies co ON o.company_id = co.id AND co.deleted = 0
   LEFT JOIN crm_contacts c ON o.contact_id = c.id AND c.deleted = 0
   WHERE o.deleted = 0 AND o.stage = ?
   ORDER BY o.created_at DESC`
);
const getCrmOpportunityByIdStmt = db.query<CrmOpportunity & { company_name: string | null; contact_name: string | null }>(
  `SELECT o.*, co.name as company_name, c.name as contact_name
   FROM crm_opportunities o
   LEFT JOIN crm_companies co ON o.company_id = co.id AND co.deleted = 0
   LEFT JOIN crm_contacts c ON o.contact_id = c.id AND c.deleted = 0
   WHERE o.id = ? AND o.deleted = 0`
);
const insertCrmOpportunityStmt = db.query<CrmOpportunity>(
  `INSERT INTO crm_opportunities (company_id, contact_id, title, value, currency, stage, probability, expected_close, notes, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING *`
);
const updateCrmOpportunityStmt = db.query<CrmOpportunity>(
  `UPDATE crm_opportunities
   SET company_id = ?, contact_id = ?, title = ?, value = ?, currency = ?, stage = ?, probability = ?, expected_close = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND deleted = 0
   RETURNING *`
);
const deleteCrmOpportunityStmt = db.query(
  "UPDATE crm_opportunities SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
);

// CRM Activities statements
const listCrmActivitiesStmt = db.query<CrmActivity & { contact_name: string | null; opportunity_title: string | null; company_name: string | null }>(
  `SELECT a.*, c.name as contact_name, o.title as opportunity_title, co.name as company_name
   FROM crm_activities a
   LEFT JOIN crm_contacts c ON a.contact_id = c.id AND c.deleted = 0
   LEFT JOIN crm_opportunities o ON a.opportunity_id = o.id AND o.deleted = 0
   LEFT JOIN crm_companies co ON a.company_id = co.id AND co.deleted = 0
   WHERE a.deleted = 0
   ORDER BY a.activity_date DESC, a.created_at DESC`
);
const listCrmActivitiesByContactStmt = db.query<CrmActivity>(
  "SELECT * FROM crm_activities WHERE contact_id = ? AND deleted = 0 ORDER BY activity_date DESC"
);
const listCrmActivitiesByOpportunityStmt = db.query<CrmActivity>(
  "SELECT * FROM crm_activities WHERE opportunity_id = ? AND deleted = 0 ORDER BY activity_date DESC"
);
const listCrmActivitiesByCompanyStmt = db.query<CrmActivity>(
  "SELECT * FROM crm_activities WHERE company_id = ? AND deleted = 0 ORDER BY activity_date DESC"
);
const getCrmActivityByIdStmt = db.query<CrmActivity>(
  "SELECT * FROM crm_activities WHERE id = ? AND deleted = 0"
);
const insertCrmActivityStmt = db.query<CrmActivity>(
  `INSERT INTO crm_activities (contact_id, opportunity_id, company_id, type, subject, description, activity_date, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING *`
);
const deleteCrmActivityStmt = db.query(
  "UPDATE crm_activities SET deleted = 1 WHERE id = ?"
);

// CRM Pipeline summary
const getCrmPipelineSummaryStmt = db.query<{ stage: string; count: number; total_value: number }>(
  `SELECT stage, COUNT(*) as count, COALESCE(SUM(value), 0) as total_value
   FROM crm_opportunities
   WHERE deleted = 0
   GROUP BY stage
   ORDER BY CASE stage
     WHEN 'lead' THEN 1
     WHEN 'qualified' THEN 2
     WHEN 'proposal' THEN 3
     WHEN 'negotiation' THEN 4
     WHEN 'closed_won' THEN 5
     WHEN 'closed_lost' THEN 6
   END`
);

// CRM Company functions
export function listCrmCompanies() {
  return listCrmCompaniesStmt.all();
}

export function getCrmCompany(id: number) {
  return getCrmCompanyByIdStmt.get(id) as CrmCompany | undefined ?? null;
}

export function createCrmCompany(
  name: string,
  website: string | null,
  industry: string | null,
  notes: string | null,
  createdBy: string
) {
  return insertCrmCompanyStmt.get(name, website, industry, notes, createdBy) as CrmCompany | undefined ?? null;
}

export function updateCrmCompany(
  id: number,
  name: string,
  website: string | null,
  industry: string | null,
  notes: string | null
) {
  return updateCrmCompanyStmt.get(name, website, industry, notes, id) as CrmCompany | undefined ?? null;
}

export function deleteCrmCompany(id: number) {
  deleteCrmCompanyStmt.run(id);
}

// CRM Contact functions
export function listCrmContacts() {
  return listCrmContactsStmt.all();
}

export function listCrmContactsByCompany(companyId: number) {
  return listCrmContactsByCompanyStmt.all(companyId);
}

export function getCrmContact(id: number) {
  return getCrmContactByIdStmt.get(id) as (CrmContact & { company_name: string | null }) | undefined ?? null;
}

export function createCrmContact(
  companyId: number | null,
  name: string,
  email: string | null,
  phone: string | null,
  npub: string | null,
  twitter: string | null,
  linkedin: string | null,
  notes: string | null,
  createdBy: string
) {
  return insertCrmContactStmt.get(companyId, name, email, phone, npub, twitter, linkedin, notes, createdBy) as CrmContact | undefined ?? null;
}

export function updateCrmContact(
  id: number,
  companyId: number | null,
  name: string,
  email: string | null,
  phone: string | null,
  npub: string | null,
  twitter: string | null,
  linkedin: string | null,
  notes: string | null
) {
  return updateCrmContactStmt.get(companyId, name, email, phone, npub, twitter, linkedin, notes, id) as CrmContact | undefined ?? null;
}

export function deleteCrmContact(id: number) {
  deleteCrmContactStmt.run(id);
}

// CRM Opportunity functions
export function listCrmOpportunities() {
  return listCrmOpportunitiesStmt.all();
}

export function listCrmOpportunitiesByStage(stage: CrmOpportunityStage) {
  return listCrmOpportunitiesByStageStmt.all(stage);
}

export function getCrmOpportunity(id: number) {
  return getCrmOpportunityByIdStmt.get(id) as (CrmOpportunity & { company_name: string | null; contact_name: string | null }) | undefined ?? null;
}

export function createCrmOpportunity(
  companyId: number | null,
  contactId: number | null,
  title: string,
  value: number | null,
  currency: string,
  stage: CrmOpportunityStage,
  probability: number,
  expectedClose: string | null,
  notes: string | null,
  createdBy: string
) {
  return insertCrmOpportunityStmt.get(companyId, contactId, title, value, currency, stage, probability, expectedClose, notes, createdBy) as CrmOpportunity | undefined ?? null;
}

export function updateCrmOpportunity(
  id: number,
  companyId: number | null,
  contactId: number | null,
  title: string,
  value: number | null,
  currency: string,
  stage: CrmOpportunityStage,
  probability: number,
  expectedClose: string | null,
  notes: string | null
) {
  return updateCrmOpportunityStmt.get(companyId, contactId, title, value, currency, stage, probability, expectedClose, notes, id) as CrmOpportunity | undefined ?? null;
}

export function deleteCrmOpportunity(id: number) {
  deleteCrmOpportunityStmt.run(id);
}

// CRM Activity functions
export function listCrmActivities() {
  return listCrmActivitiesStmt.all();
}

export function listCrmActivitiesByContact(contactId: number) {
  return listCrmActivitiesByContactStmt.all(contactId);
}

export function listCrmActivitiesByOpportunity(opportunityId: number) {
  return listCrmActivitiesByOpportunityStmt.all(opportunityId);
}

export function listCrmActivitiesByCompany(companyId: number) {
  return listCrmActivitiesByCompanyStmt.all(companyId);
}

export function getCrmActivity(id: number) {
  return getCrmActivityByIdStmt.get(id) as CrmActivity | undefined ?? null;
}

export function createCrmActivity(
  contactId: number | null,
  opportunityId: number | null,
  companyId: number | null,
  type: CrmActivityType,
  subject: string,
  description: string | null,
  activityDate: string,
  createdBy: string
) {
  return insertCrmActivityStmt.get(contactId, opportunityId, companyId, type, subject, description, activityDate, createdBy) as CrmActivity | undefined ?? null;
}

export function deleteCrmActivity(id: number) {
  deleteCrmActivityStmt.run(id);
}

// CRM Pipeline summary
export function getCrmPipelineSummary() {
  return getCrmPipelineSummaryStmt.all();
}

// Wallet transaction statements
const insertWalletTxStmt = db.query<WalletTransaction>(
  `INSERT INTO wallet_transactions (npub, type, amount_msats, invoice, payment_hash, state, description)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   RETURNING *`
);
const listWalletTxStmt = db.query<WalletTransaction>(
  "SELECT * FROM wallet_transactions WHERE npub = ? ORDER BY created_at DESC LIMIT ?"
);
const getWalletTxByHashStmt = db.query<WalletTransaction>(
  "SELECT * FROM wallet_transactions WHERE npub = ? AND payment_hash = ?"
);
const updateWalletTxStateStmt = db.query<WalletTransaction>(
  `UPDATE wallet_transactions SET state = ?, settled_at = CASE WHEN ? = 'settled' THEN CURRENT_TIMESTAMP ELSE settled_at END
   WHERE id = ? RETURNING *`
);

// Wallet transaction functions
export function saveWalletTransaction(
  npub: string,
  type: "incoming" | "outgoing",
  amountMsats: number,
  invoice: string | null,
  paymentHash: string | null,
  state: "pending" | "settled" | "failed",
  description: string | null
) {
  return insertWalletTxStmt.get(npub, type, amountMsats, invoice, paymentHash, state, description) as WalletTransaction | undefined ?? null;
}

export function listWalletTransactions(npub: string, limit: number = 50) {
  return listWalletTxStmt.all(npub, limit);
}

export function getWalletTransactionByHash(npub: string, paymentHash: string) {
  return getWalletTxByHashStmt.get(npub, paymentHash) as WalletTransaction | undefined ?? null;
}

export function updateWalletTransactionState(id: number, state: "pending" | "settled" | "failed") {
  return updateWalletTxStateStmt.get(state, state, id) as WalletTransaction | undefined ?? null;
}

// Session prepared statements
const insertSessionStmt = db.query(
  `INSERT INTO sessions (token, pubkey, npub, method, created_at, expires_at, current_team_id, current_team_slug, team_memberships)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getSessionStmt = db.query<DbSession>(
  "SELECT * FROM sessions WHERE token = ? AND expires_at > ?"
);
const updateSessionStmt = db.query(
  `UPDATE sessions SET current_team_id = ?, current_team_slug = ?, team_memberships = ? WHERE token = ?`
);
const deleteSessionStmt = db.query("DELETE FROM sessions WHERE token = ?");
const deleteExpiredSessionsStmt = db.query("DELETE FROM sessions WHERE expires_at <= ?");

// Session functions
export function saveSession(
  token: string,
  pubkey: string,
  npub: string,
  method: string,
  createdAt: number,
  expiresAt: number,
  currentTeamId: number | null,
  currentTeamSlug: string | null,
  teamMemberships: string | null
) {
  insertSessionStmt.run(token, pubkey, npub, method, createdAt, expiresAt, currentTeamId, currentTeamSlug, teamMemberships);
}

export function getSession(token: string): DbSession | null {
  const now = Date.now();
  return getSessionStmt.get(token, now) as DbSession | undefined ?? null;
}

export function updateSession(
  token: string,
  currentTeamId: number | null,
  currentTeamSlug: string | null,
  teamMemberships: string | null
) {
  updateSessionStmt.run(currentTeamId, currentTeamSlug, teamMemberships, token);
}

export function deleteSession(token: string) {
  deleteSessionStmt.run(token);
}

export function cleanupExpiredSessions() {
  const now = Date.now();
  deleteExpiredSessionsStmt.run(now);
}

export function resetDatabase() {
  db.run("DELETE FROM task_threads");
  db.run("DELETE FROM todos");
  db.run("DELETE FROM ai_summaries");
  db.run("DELETE FROM channel_groups");
  db.run("DELETE FROM group_members");
  db.run("DELETE FROM groups");
  db.run("DELETE FROM user_channel_keys");
  db.run("DELETE FROM dm_participants");
  db.run("DELETE FROM channels");
  db.run("DELETE FROM channel_members");
  db.run("DELETE FROM messages");
  db.run("DELETE FROM message_mentions");
  db.run("DELETE FROM message_reactions");
  db.run("DELETE FROM users");
  db.run("DELETE FROM push_subscriptions");
  db.run("DELETE FROM wingman_costs");
  db.run("DELETE FROM community_keys");
  db.run("DELETE FROM community_state");
  db.run("DELETE FROM invite_redemptions");
  db.run("DELETE FROM invite_codes");
  db.run("DELETE FROM crm_activities");
  db.run("DELETE FROM crm_opportunities");
  db.run("DELETE FROM crm_contacts");
  db.run("DELETE FROM crm_companies");
  db.run("DELETE FROM wallet_transactions");
  db.run("DELETE FROM sessions");
  // Note: vapid_config is intentionally NOT reset to preserve VAPID keys
  db.run(
    "DELETE FROM sqlite_sequence WHERE name IN ('todos', 'ai_summaries', 'channels', 'messages', 'message_mentions', 'message_reactions', 'groups', 'push_subscriptions', 'task_threads', 'wingman_costs', 'invite_codes', 'invite_redemptions', 'crm_companies', 'crm_contacts', 'crm_opportunities', 'crm_activities', 'wallet_transactions')"
  );
}
