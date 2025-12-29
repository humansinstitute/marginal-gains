import { Database } from "bun:sqlite";

import type { TodoPriority, TodoState } from "./types";

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

const dbPath = process.env.DB_PATH || Bun.env.DB_PATH || "do-the-other-stuff.sqlite";
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

// Add owner_npub for personal channels (Note to self)
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

const listByOwnerStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND owner = ? ORDER BY created_at DESC"
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
const insertStmt = db.query(
  "INSERT INTO todos (title, description, priority, state, done, owner, tags) VALUES (?, '', 'sand', 'new', 0, ?, ?) RETURNING *"
);
const insertFullStmt = db.query<Todo>(
  `INSERT INTO todos (title, description, priority, state, done, owner, scheduled_for, tags)
   VALUES (?, ?, ?, ?, CASE WHEN ? = 'done' THEN 1 ELSE 0 END, ?, ?, ?)
   RETURNING *`
);
const deleteStmt = db.query("UPDATE todos SET deleted = 1 WHERE id = ? AND owner = ?");
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

// Channel statements (excludes personal channels)
const listChannelsStmt = db.query<Channel>(
  "SELECT * FROM channels WHERE owner_npub IS NULL ORDER BY created_at ASC"
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

export function listScheduledTodos(owner: string, endDate: string) {
  return listScheduledStmt.all(owner, endDate);
}

export function listUnscheduledTodos(owner: string) {
  return listUnscheduledStmt.all(owner);
}

export function addTodo(title: string, owner: string, tags: string = "") {
  if (!title.trim()) return null;
  const todo = insertStmt.get(title.trim(), owner, tags) as Todo | undefined;
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
  }
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
    tags
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
// Excludes personal channels (owner_npub IS NOT NULL) - those are fetched separately
const listVisibleChannelsStmt = db.query<Channel>(
  `SELECT DISTINCT c.* FROM channels c
   WHERE c.owner_npub IS NULL AND (
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

export function resetDatabase() {
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
  db.run(
    "DELETE FROM sqlite_sequence WHERE name IN ('todos', 'ai_summaries', 'channels', 'messages', 'message_mentions', 'message_reactions', 'groups')"
  );
}
