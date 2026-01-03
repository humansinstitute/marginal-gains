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
  created_at: string;
  edited_at: string | null;
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

// Index for efficient group todo queries
try {
  db.run("CREATE INDEX idx_todos_group_id ON todos(group_id)");
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

const listByOwnerStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND owner = ? AND group_id IS NULL ORDER BY created_at DESC"
);
const listByGroupStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND group_id = ? ORDER BY created_at DESC"
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
  "INSERT INTO todos (title, description, priority, state, done, owner, tags, group_id) VALUES (?, '', 'sand', 'new', 0, ?, ?, ?) RETURNING *"
);
const insertFullStmt = db.query<Todo>(
  `INSERT INTO todos (title, description, priority, state, done, owner, scheduled_for, tags, group_id)
   VALUES (?, ?, ?, ?, CASE WHEN ? = 'done' THEN 1 ELSE 0 END, ?, ?, ?, ?)
   RETURNING *`
);
const deleteStmt = db.query("UPDATE todos SET deleted = 1 WHERE id = ? AND owner = ?");
const deleteGroupTodoStmt = db.query("UPDATE todos SET deleted = 1 WHERE id = ? AND group_id = ?");
const getTodoByIdStmt = db.query<Todo>("SELECT * FROM todos WHERE id = ? AND deleted = 0");
const updateStmt = db.query<Todo>(
  `UPDATE todos
   SET
    title = ?,
    description = ?,
    priority = ?,
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    scheduled_for = ?,
    tags = ?
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
const updateGroupTodoStmt = db.query<Todo>(
  `UPDATE todos
   SET
    title = ?,
    description = ?,
    priority = ?,
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    scheduled_for = ?,
    tags = ?
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
   AND NOT EXISTS (SELECT 1 FROM dm_participants WHERE channel_id = id)
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
const getMessageByIdStmt = db.query<Message>(
  "SELECT * FROM messages WHERE id = ?"
);
const deleteMessageStmt = db.query("DELETE FROM messages WHERE id = ?");

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

export function listGroupTodos(groupId: number, filterTags?: string[]) {
  const todos = listByGroupStmt.all(groupId);
  if (!filterTags || filterTags.length === 0) return todos;
  return todos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  });
}

export function getTodoById(id: number) {
  return getTodoByIdStmt.get(id) as Todo | undefined ?? null;
}

export function listScheduledTodos(owner: string, endDate: string) {
  return listScheduledStmt.all(owner, endDate);
}

export function listUnscheduledTodos(owner: string) {
  return listUnscheduledStmt.all(owner);
}

export function addTodo(title: string, owner: string, tags: string = "", groupId: number | null = null) {
  if (!title.trim()) return null;
  const todo = insertStmt.get(title.trim(), owner, tags, groupId) as Todo | undefined;
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
  const todo = insertFullStmt.get(
    title,
    description,
    priority,
    state,
    state,
    owner,
    scheduled_for,
    tags,
    groupId
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
    id,
    owner
  ) as Todo | undefined;
  return todo ?? null;
}

export function transitionTodo(id: number, owner: string, state: TodoState) {
  const todo = transitionStmt.get(state, state, id, owner) as Todo | undefined;
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
    id,
    groupId
  ) as Todo | undefined;
  return todo ?? null;
}

export function transitionGroupTodo(id: number, groupId: number, state: TodoState) {
  const todo = transitionGroupTodoStmt.get(state, state, id, groupId) as Todo | undefined;
  return todo ?? null;
}

export function assignAllTodosToOwner(npub: string) {
  if (!npub) return;
  db.run("UPDATE todos SET owner = ? WHERE owner = '' OR owner IS NULL", npub);
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

export function deleteMessage(id: number): boolean {
  const result = deleteMessageStmt.run(id);
  return result.changes > 0;
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
   AND NOT EXISTS (SELECT 1 FROM dm_participants WHERE channel_id = c.id)
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

export function resetDatabase() {
  db.run("DELETE FROM task_threads");
  db.run("DELETE FROM todos");
  db.run("DELETE FROM ai_summaries");
  db.run("DELETE FROM channel_groups");
  db.run("DELETE FROM group_members");
  db.run("DELETE FROM groups");
  db.run("DELETE FROM dm_participants");
  db.run("DELETE FROM channels");
  db.run("DELETE FROM channel_members");
  db.run("DELETE FROM messages");
  db.run("DELETE FROM message_mentions");
  db.run("DELETE FROM message_reactions");
  db.run("DELETE FROM users");
  db.run("DELETE FROM push_subscriptions");
  db.run("DELETE FROM wingman_costs");
  db.run("DELETE FROM crm_activities");
  db.run("DELETE FROM crm_opportunities");
  db.run("DELETE FROM crm_contacts");
  db.run("DELETE FROM crm_companies");
  db.run("DELETE FROM wallet_transactions");
  // Note: vapid_config is intentionally NOT reset to preserve VAPID keys
  db.run(
    "DELETE FROM sqlite_sequence WHERE name IN ('todos', 'ai_summaries', 'channels', 'messages', 'message_mentions', 'message_reactions', 'groups', 'push_subscriptions', 'task_threads', 'wingman_costs', 'crm_companies', 'crm_contacts', 'crm_opportunities', 'crm_activities', 'wallet_transactions')"
  );
}
