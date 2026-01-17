/**
 * TeamDatabase - Database wrapper for team-scoped operations
 *
 * This class wraps all database operations and accepts a Database instance,
 * enabling multi-tenancy where each team has its own isolated database.
 *
 * Usage:
 *   const teamDb = new TeamDatabase(ctx.teamDb);
 *   const channels = teamDb.listChannels();
 */

import type {
  AppSetting,
  Channel,
  ChannelReadState,
  CommunityKey,
  CrmActivity,
  CrmCompany,
  CrmContact,
  CrmOpportunity,
  CrmOpportunityStage,
  Group,
  GroupMember,
  InviteCode,
  Message,
  PushSubscription,
  Reaction,
  ReactionGroup,
  Summary,
  TaskThread,
  TeamEncryption,
  Todo,
  UnreadCount,
  User,
  UserChannelKey,
  UserTeamKey,
  VapidConfig,
  WalletTransaction,
  WingmanCost,
} from "./db";
import type { NotificationFrequency, TodoPriority, TodoState } from "./types";
import type { Database } from "bun:sqlite";

// Re-export types from db.ts for convenience
export type {
  AppSetting,
  Channel,
  ChannelGroup,
  ChannelReadState,
  CommunityKey,
  CommunityState,
  CrmActivity,
  CrmCompany,
  CrmContact,
  CrmOpportunity,
  CrmOpportunityStage,
  DmParticipant,
  Group,
  GroupMember,
  InviteCode,
  InviteRedemption,
  Message,
  PushSubscription,
  Reaction,
  ReactionGroup,
  Summary,
  TaskThread,
  TeamEncryption,
  Todo,
  UnreadCount,
  User,
  UserChannelKey,
  UserTeamKey,
  VapidConfig,
  WalletTransaction,
  WingmanCost,
} from "./db";

// KeyRequest type - for distributing encryption keys to new members
export type KeyRequest = {
  id: number;
  channel_id: number;
  requester_npub: string;
  requester_pubkey: string;
  target_npub: string;
  invite_code_hash: string | null;
  group_id: number | null;
  status: "pending" | "fulfilled" | "rejected";
  fulfilled_by: string | null;
  fulfilled_at: string | null;
  created_at: string;
};

export class TeamDatabase {
  constructor(private db: Database) {}

  // ============================================================================
  // Todos
  // ============================================================================

  listTodos(owner: string | null, filterTags?: string[]): Todo[] {
    if (owner === null) {
      return this.db.query<Todo, []>("SELECT * FROM todos WHERE deleted = 0 AND group_id IS NULL ORDER BY created_at DESC").all();
    }
    let query = "SELECT * FROM todos WHERE owner = ? AND deleted = 0 AND group_id IS NULL";
    const params: (string | number)[] = [owner];
    if (filterTags && filterTags.length > 0) {
      const tagConditions = filterTags.map(() => "tags LIKE ?").join(" OR ");
      query += ` AND (${tagConditions})`;
      params.push(...filterTags.map((tag) => `%${tag}%`));
    }
    query += " ORDER BY created_at DESC";
    return this.db.query<Todo, (string | number)[]>(query).all(...params);
  }

  listGroupTodos(groupId: number, filterTags?: string[]): Todo[] {
    let query = "SELECT * FROM todos WHERE group_id = ? AND deleted = 0";
    const params: (string | number)[] = [groupId];
    if (filterTags && filterTags.length > 0) {
      const tagConditions = filterTags.map(() => "tags LIKE ?").join(" OR ");
      query += ` AND (${tagConditions})`;
      params.push(...filterTags.map((tag) => `%${tag}%`));
    }
    query += " ORDER BY created_at DESC";
    return this.db.query<Todo, (string | number)[]>(query).all(...params);
  }

  getTodoById(id: number): Todo | null {
    return this.db.query<Todo, [number]>("SELECT * FROM todos WHERE id = ?").get(id) ?? null;
  }

  listScheduledTodos(owner: string, endDate: string): Todo[] {
    return this.db.query<Todo, [string, string]>(
      "SELECT * FROM todos WHERE owner = ? AND deleted = 0 AND scheduled_for IS NOT NULL AND scheduled_for <= ? ORDER BY scheduled_for ASC"
    ).all(owner, endDate);
  }

  listUnscheduledTodos(owner: string): Todo[] {
    return this.db.query<Todo, [string]>(
      "SELECT * FROM todos WHERE owner = ? AND deleted = 0 AND scheduled_for IS NULL ORDER BY created_at DESC"
    ).all(owner);
  }

  addTodo(title: string, owner: string, tags: string = "", groupId: number | null = null): Todo | null {
    return this.db.query<Todo, [string, string, string, number | null]>(
      "INSERT INTO todos (title, owner, tags, group_id) VALUES (?, ?, ?, ?) RETURNING *"
    ).get(title, owner, tags, groupId) ?? null;
  }

  addTodoFull(params: {
    title: string;
    owner: string;
    description?: string;
    priority?: TodoPriority;
    state?: TodoState;
    tags?: string;
    scheduledFor?: string | null;
    groupId?: number | null;
  }): Todo | null {
    const {
      title,
      owner,
      description = "",
      priority = "sand",
      state = "new",
      tags = "",
      scheduledFor = null,
      groupId = null,
    } = params;
    return this.db.query<Todo, [string, string, string, string, string, string, string | null, number | null]>(
      `INSERT INTO todos (title, owner, description, priority, state, tags, scheduled_for, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(title, owner, description, priority, state, tags, scheduledFor, groupId) ?? null;
  }

  deleteTodo(id: number, owner: string): void {
    this.db.run("UPDATE todos SET deleted = 1 WHERE id = ? AND owner = ?", [id, owner]);
  }

  updateTodo(params: {
    id: number;
    owner: string;
    title?: string;
    description?: string;
    priority?: TodoPriority;
    state?: TodoState;
    tags?: string;
    scheduledFor?: string | null;
    assignedTo?: string | null;
  }): Todo | null {
    const { id, owner, title, description, priority, state, tags, scheduledFor, assignedTo } = params;
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (title !== undefined) { sets.push("title = ?"); values.push(title); }
    if (description !== undefined) { sets.push("description = ?"); values.push(description); }
    if (priority !== undefined) { sets.push("priority = ?"); values.push(priority); }
    if (state !== undefined) { sets.push("state = ?"); values.push(state); }
    if (tags !== undefined) { sets.push("tags = ?"); values.push(tags); }
    if (scheduledFor !== undefined) { sets.push("scheduled_for = ?"); values.push(scheduledFor); }
    if (assignedTo !== undefined) { sets.push("assigned_to = ?"); values.push(assignedTo); }

    if (sets.length === 0) return this.getTodoById(id);

    values.push(id, owner);
    return this.db.query<Todo, (string | number | null)[]>(
      `UPDATE todos SET ${sets.join(", ")} WHERE id = ? AND owner = ? RETURNING *`
    ).get(...values) ?? null;
  }

  transitionTodo(id: number, owner: string, state: TodoState): Todo | null {
    const done = state === "done" ? 1 : 0;
    const result = this.db.query<Todo, [string, number, number, string]>(
      "UPDATE todos SET state = ?, done = ? WHERE id = ? AND owner = ? RETURNING *"
    ).get(state, done, id, owner) ?? null;
    // Sync parent state if this is a subtask
    if (result) this.syncParentStateAfterSubtaskChange(id);
    return result;
  }

  transitionTodoWithPosition(id: number, owner: string, state: TodoState, position: number | null): Todo | null {
    const done = state === "done" ? 1 : 0;
    const result = this.db.query<Todo, [string, number, number | null, number, string]>(
      "UPDATE todos SET state = ?, done = ?, position = ? WHERE id = ? AND owner = ? RETURNING *"
    ).get(state, done, position, id, owner) ?? null;
    // Sync parent state if this is a subtask
    if (result) this.syncParentStateAfterSubtaskChange(id);
    return result;
  }

  deleteGroupTodo(id: number, groupId: number): void {
    this.db.run("UPDATE todos SET deleted = 1 WHERE id = ? AND group_id = ?", [id, groupId]);
  }

  updateGroupTodo(params: {
    id: number;
    groupId: number;
    title?: string;
    description?: string;
    priority?: TodoPriority;
    state?: TodoState;
    tags?: string;
    scheduledFor?: string | null;
    assignedTo?: string | null;
  }): Todo | null {
    const { id, groupId, title, description, priority, state, tags, scheduledFor, assignedTo } = params;
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (title !== undefined) { sets.push("title = ?"); values.push(title); }
    if (description !== undefined) { sets.push("description = ?"); values.push(description); }
    if (priority !== undefined) { sets.push("priority = ?"); values.push(priority); }
    if (state !== undefined) { sets.push("state = ?"); values.push(state); }
    if (tags !== undefined) { sets.push("tags = ?"); values.push(tags); }
    if (scheduledFor !== undefined) { sets.push("scheduled_for = ?"); values.push(scheduledFor); }
    if (assignedTo !== undefined) { sets.push("assigned_to = ?"); values.push(assignedTo); }

    if (sets.length === 0) return this.getTodoById(id);

    values.push(id, groupId);
    return this.db.query<Todo, (string | number | null)[]>(
      `UPDATE todos SET ${sets.join(", ")} WHERE id = ? AND group_id = ? RETURNING *`
    ).get(...values) ?? null;
  }

  transitionGroupTodo(id: number, groupId: number, state: TodoState): Todo | null {
    const done = state === "done" ? 1 : 0;
    const result = this.db.query<Todo, [string, number, number, number]>(
      "UPDATE todos SET state = ?, done = ? WHERE id = ? AND group_id = ? RETURNING *"
    ).get(state, done, id, groupId) ?? null;
    // Sync parent state if this is a subtask
    if (result) this.syncParentStateAfterSubtaskChange(id);
    return result;
  }

  transitionGroupTodoWithPosition(id: number, groupId: number, state: TodoState, position: number | null): Todo | null {
    const done = state === "done" ? 1 : 0;
    const result = this.db.query<Todo, [string, number, number | null, number, number]>(
      "UPDATE todos SET state = ?, done = ?, position = ? WHERE id = ? AND group_id = ? RETURNING *"
    ).get(state, done, position, id, groupId) ?? null;
    // Sync parent state if this is a subtask
    if (result) this.syncParentStateAfterSubtaskChange(id);
    return result;
  }

  updateTodoPosition(id: number, position: number | null): Todo | null {
    return this.db.query<Todo, [number | null, number]>(
      "UPDATE todos SET position = ? WHERE id = ? AND deleted = 0 RETURNING *"
    ).get(position, id) ?? null;
  }

  assignAllTodosToOwner(npub: string): void {
    this.db.run("UPDATE todos SET owner = ? WHERE owner = ''", [npub]);
  }

  // ============================================================================
  // Subtasks
  // ============================================================================

  listSubtasks(parentId: number): Todo[] {
    return this.db.query<Todo, [number]>(
      "SELECT * FROM todos WHERE parent_id = ? AND deleted = 0 ORDER BY position ASC, created_at DESC"
    ).all(parentId);
  }

  hasSubtasks(todoId: number): boolean {
    const result = this.db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM todos WHERE parent_id = ? AND deleted = 0"
    ).get(todoId);
    return (result?.count ?? 0) > 0;
  }

  canHaveChildren(todo: Todo): boolean {
    // Can only add children if not already a subtask (2 levels max)
    return todo.parent_id === null;
  }

  /**
   * Propagate tags from a parent task to all its children.
   * Call this after updating a parent task's tags.
   */
  propagateTagsToChildren(parentId: number, tags: string): void {
    this.db.run("UPDATE todos SET tags = ? WHERE parent_id = ? AND deleted = 0", [tags, parentId]);
  }

  addSubtask(title: string, parentId: number, assignedTo: string | null = null): Todo | null {
    // Inherit group_id and owner from parent
    return this.db.query<Todo, [string, string | null, number]>(
      `INSERT INTO todos (title, description, priority, state, done, owner, tags, group_id, assigned_to, parent_id)
       SELECT ?, '', 'sand', 'new', 0, owner, '', group_id, ?, ?
       FROM todos WHERE id = ?
       RETURNING *`
    ).get(title, assignedTo, parentId, parentId) ?? null;
  }

  orphanSubtasks(parentId: number): void {
    this.db.run("UPDATE todos SET parent_id = NULL WHERE parent_id = ?", [parentId]);
  }

  getSubtaskProgress(parentId: number): { total: number; done: number; inProgress: number } {
    const subtasks = this.listSubtasks(parentId);
    return {
      total: subtasks.length,
      done: subtasks.filter((s) => s.state === "done").length,
      inProgress: subtasks.filter((s) => s.state === "in_progress" || s.state === "review").length,
    };
  }

  // State ordering for parent computation (lower = earlier in workflow)
  private static STATE_ORDER: Record<string, number> = {
    new: 0,
    ready: 1,
    in_progress: 2,
    review: 3,
    done: 4,
  };

  private static STATE_BY_ORDER: string[] = ["new", "ready", "in_progress", "review", "done"];

  /**
   * Compute the state a parent should have based on its subtasks.
   * Parent state = minimum (slowest/earliest) state of all subtasks.
   */
  computeParentState(parentId: number): string | null {
    const subtasks = this.listSubtasks(parentId);
    if (subtasks.length === 0) return null;

    let minOrder = TeamDatabase.STATE_ORDER.done;
    for (const subtask of subtasks) {
      const order = TeamDatabase.STATE_ORDER[subtask.state] ?? 0;
      if (order < minOrder) {
        minOrder = order;
      }
    }
    return TeamDatabase.STATE_BY_ORDER[minOrder];
  }

  /**
   * Update a parent task's state to match its slowest subtask.
   */
  updateParentStateFromSubtasks(parentId: number): Todo | null {
    const parent = this.getTodoById(parentId);
    if (!parent) return null;

    const computedState = this.computeParentState(parentId);
    if (!computedState) return parent;

    if (parent.state === computedState) return parent;

    return this.db.query<Todo, [string, string, number]>(
      `UPDATE todos SET state = ?, done = (? = 'done'), updated_at = datetime('now')
       WHERE id = ? AND deleted = 0 RETURNING *`
    ).get(computedState, computedState, parentId) ?? null;
  }

  /**
   * After changing a subtask's state, update its parent's state if needed.
   */
  syncParentStateAfterSubtaskChange(subtaskId: number): Todo | null {
    const subtask = this.getTodoById(subtaskId);
    if (!subtask || !subtask.parent_id) return null;

    return this.updateParentStateFromSubtasks(subtask.parent_id);
  }

  // ============================================================================
  // AI Summaries
  // ============================================================================

  upsertSummary(params: {
    owner: string;
    summaryDate: string;
    dayAhead?: string | null;
    weekAhead?: string | null;
    suggestions?: string | null;
  }): Summary | null {
    const { owner, summaryDate, dayAhead = null, weekAhead = null, suggestions = null } = params;
    return this.db.query<Summary, [string, string, string | null, string | null, string | null]>(
      `INSERT INTO ai_summaries (owner, summary_date, day_ahead, week_ahead, suggestions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner, summary_date) DO UPDATE SET
         day_ahead = COALESCE(excluded.day_ahead, ai_summaries.day_ahead),
         week_ahead = COALESCE(excluded.week_ahead, ai_summaries.week_ahead),
         suggestions = COALESCE(excluded.suggestions, ai_summaries.suggestions),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`
    ).get(owner, summaryDate, dayAhead, weekAhead, suggestions) ?? null;
  }

  getLatestSummaries(owner: string, today: string, weekStart: string, weekEnd: string): { day: Summary | null; week: Summary | null } {
    const day = this.db.query<Summary, [string, string]>(
      "SELECT * FROM ai_summaries WHERE owner = ? AND summary_date = ? AND day_ahead IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
    ).get(owner, today) ?? null;
    const week = this.db.query<Summary, [string, string, string]>(
      "SELECT * FROM ai_summaries WHERE owner = ? AND summary_date >= ? AND summary_date <= ? AND week_ahead IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
    ).get(owner, weekStart, weekEnd) ?? null;
    return { day, week };
  }

  // ============================================================================
  // Channels
  // ============================================================================

  listChannels(): Channel[] {
    return this.db.query<Channel, []>("SELECT * FROM channels ORDER BY created_at DESC").all();
  }

  getChannel(id: number): Channel | null {
    return this.db.query<Channel, [number]>("SELECT * FROM channels WHERE id = ?").get(id) ?? null;
  }

  getChannelByName(name: string): Channel | null {
    return this.db.query<Channel, [string]>("SELECT * FROM channels WHERE name = ?").get(name) ?? null;
  }

  createChannel(name: string, displayName: string, description: string, creator: string, isPublic: boolean): Channel | null {
    return this.db.query<Channel, [string, string, string, string, number]>(
      "INSERT INTO channels (name, display_name, description, creator, is_public) VALUES (?, ?, ?, ?, ?) RETURNING *"
    ).get(name, displayName, description, creator, isPublic ? 1 : 0) ?? null;
  }

  createEncryptedChannel(name: string, displayName: string, description: string, creator: string, isPublic: boolean): Channel | null {
    return this.db.query<Channel, [string, string, string, string, number]>(
      "INSERT INTO channels (name, display_name, description, creator, is_public, encrypted, encryption_enabled_at) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP) RETURNING *"
    ).get(name, displayName, description, creator, isPublic ? 1 : 0) ?? null;
  }

  updateChannel(id: number, displayName: string, description: string, isPublic: boolean): Channel | null {
    return this.db.query<Channel, [string, string, number, number]>(
      "UPDATE channels SET display_name = ?, description = ?, is_public = ? WHERE id = ? RETURNING *"
    ).get(displayName, description, isPublic ? 1 : 0, id) ?? null;
  }

  deleteChannel(id: number): void {
    this.db.run("DELETE FROM channels WHERE id = ?", [id]);
  }

  listVisibleChannels(npub: string): Channel[] {
    return this.db.query<Channel, [string]>(
      `SELECT DISTINCT c.* FROM channels c
       LEFT JOIN channel_groups cg ON c.id = cg.channel_id
       LEFT JOIN group_members gm ON cg.group_id = gm.group_id
       WHERE c.name NOT LIKE 'dm-%'
         AND c.owner_npub IS NULL
         AND (c.is_public = 1 OR gm.npub = ?)
       ORDER BY c.id`
    ).all(npub);
  }

  listAllChannels(): Channel[] {
    return this.db.query<Channel, []>(
      `SELECT * FROM channels
       WHERE name NOT LIKE 'dm-%'
         AND owner_npub IS NULL
       ORDER BY created_at DESC`
    ).all();
  }

  canUserAccessChannel(channelId: number, npub: string): boolean {
    const result = this.db.query<{ can_access: number }, [number, string, string]>(
      `SELECT CASE WHEN EXISTS (
        SELECT 1 FROM channels c
        LEFT JOIN channel_groups cg ON c.id = cg.channel_id
        LEFT JOIN group_members gm ON cg.group_id = gm.group_id
        WHERE c.id = ? AND (c.is_public = 1 OR c.owner_npub = ? OR gm.npub = ?)
      ) THEN 1 ELSE 0 END as can_access`
    ).get(channelId, npub, npub);
    return result?.can_access === 1;
  }

  getPersonalChannel(npub: string): Channel | null {
    return this.db.query<Channel, [string]>(
      "SELECT * FROM channels WHERE owner_npub = ? AND is_public = 0"
    ).get(npub) ?? null;
  }

  getOrCreatePersonalChannel(npub: string): Channel | null {
    let channel = this.getPersonalChannel(npub);
    if (!channel) {
      const name = `note-to-self-${npub.slice(0, 8)}`;
      channel = this.db.query<Channel, [string, string]>(
        "INSERT INTO channels (name, display_name, description, creator, is_public, owner_npub) VALUES (?, 'Note to self', 'Your private notes', ?, 0, ?) RETURNING *"
      ).get(name, npub, npub) ?? null;
    }
    return channel;
  }

  // ============================================================================
  // DM Channels
  // ============================================================================

  listDmChannels(npub: string): (Channel & { other_npub: string | null })[] {
    return this.db.query<Channel & { other_npub: string | null }, [string, string]>(
      `SELECT c.*,
              (SELECT dp2.npub FROM dm_participants dp2
               WHERE dp2.channel_id = c.id AND dp2.npub != ?) as other_npub
       FROM channels c
       JOIN dm_participants dp ON c.id = dp.channel_id
       WHERE dp.npub = ?
       ORDER BY c.created_at DESC`
    ).all(npub, npub);
  }

  findDmChannel(npub1: string, npub2: string): Channel | null {
    return this.db.query<Channel, [string, string]>(
      `SELECT c.* FROM channels c
       JOIN dm_participants dp1 ON c.id = dp1.channel_id AND dp1.npub = ?
       JOIN dm_participants dp2 ON c.id = dp2.channel_id AND dp2.npub = ?
       LIMIT 1`
    ).get(npub1, npub2) ?? null;
  }

  getDmParticipants(channelId: number): string[] {
    const rows = this.db.query<{ npub: string }, [number]>(
      "SELECT npub FROM dm_participants WHERE channel_id = ?"
    ).all(channelId);
    return rows.map(r => r.npub);
  }

  getOrCreateDmChannel(creatorNpub: string, otherNpub: string, displayName: string): Channel | null {
    // Check for existing DM channel
    let channel = this.findDmChannel(creatorNpub, otherNpub);
    if (channel) return channel;

    // Create new DM channel
    const name = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    channel = this.db.query<Channel, [string, string, string]>(
      "INSERT INTO channels (name, display_name, description, creator, is_public) VALUES (?, ?, '', ?, 0) RETURNING *"
    ).get(name, displayName, creatorNpub) ?? null;

    if (channel) {
      // Add participants
      this.db.run("INSERT INTO dm_participants (channel_id, npub) VALUES (?, ?)", [channel.id, creatorNpub]);
      this.db.run("INSERT INTO dm_participants (channel_id, npub) VALUES (?, ?)", [channel.id, otherNpub]);
    }

    return channel;
  }

  // ============================================================================
  // Messages
  // ============================================================================

  listMessages(channelId: number): Message[] {
    return this.db.query<Message, [number]>(
      "SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at ASC"
    ).all(channelId);
  }

  listThreadMessages(rootId: number): Message[] {
    return this.db.query<Message, [number, number]>(
      "SELECT * FROM messages WHERE id = ? OR thread_root_id = ? ORDER BY created_at ASC"
    ).all(rootId, rootId);
  }

  getMessage(id: number): Message | null {
    return this.db.query<Message, [number]>("SELECT * FROM messages WHERE id = ?").get(id) ?? null;
  }

  createMessage(
    channelId: number,
    author: string,
    body: string,
    threadRootId: number | null,
    parentId: number | null,
    quotedMessageId: number | null
  ): Message | null {
    return this.db.query<Message, [number, string, string, number | null, number | null, number | null]>(
      "INSERT INTO messages (channel_id, author, body, thread_root_id, parent_id, quoted_message_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
    ).get(channelId, author, body, threadRootId, parentId, quotedMessageId) ?? null;
  }

  createEncryptedMessage(
    channelId: number,
    author: string,
    encryptedBody: string,
    threadRootId: number | null,
    parentId: number | null,
    quotedMessageId: number | null,
    keyVersion: number
  ): Message | null {
    return this.db.query<Message, [number, string, string, number | null, number | null, number | null, number]>(
      "INSERT INTO messages (channel_id, author, body, thread_root_id, parent_id, quoted_message_id, encrypted, key_version) VALUES (?, ?, ?, ?, ?, ?, 1, ?) RETURNING *"
    ).get(channelId, author, encryptedBody, threadRootId, parentId, quotedMessageId, keyVersion) ?? null;
  }

  deleteMessage(id: number): boolean {
    const result = this.db.run("DELETE FROM messages WHERE id = ?", [id]);
    return result.changes > 0;
  }

  // ============================================================================
  // Reactions
  // ============================================================================

  toggleReaction(
    messageId: number,
    reactor: string,
    emoji: string
  ): { action: "add" | "remove"; reaction?: Reaction } {
    const existing = this.db.query<Reaction, [number, string, string]>(
      "SELECT * FROM message_reactions WHERE message_id = ? AND reactor = ? AND emoji = ?"
    ).get(messageId, reactor, emoji);

    if (existing) {
      this.db.run(
        "DELETE FROM message_reactions WHERE message_id = ? AND reactor = ? AND emoji = ?",
        [messageId, reactor, emoji]
      );
      return { action: "remove" };
    }

    const reaction = this.db.query<Reaction, [number, string, string]>(
      "INSERT INTO message_reactions (message_id, reactor, emoji) VALUES (?, ?, ?) RETURNING *"
    ).get(messageId, reactor, emoji);

    return { action: "add", reaction: reaction ?? undefined };
  }

  getMessageReactions(messageId: number): ReactionGroup[] {
    const reactions = this.db.query<Reaction, [number]>(
      "SELECT * FROM message_reactions WHERE message_id = ? ORDER BY created_at ASC"
    ).all(messageId);

    return this.groupReactions(reactions);
  }

  private groupReactions(reactions: Reaction[]): ReactionGroup[] {
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

  getLatestMessageId(channelId: number): number | null {
    const result = this.db.query<{ max_id: number | null }, [number]>(
      "SELECT MAX(id) as max_id FROM messages WHERE channel_id = ?"
    ).get(channelId);
    return result?.max_id ?? null;
  }

  // ============================================================================
  // Channel Read State
  // ============================================================================

  getChannelReadState(npub: string, channelId: number): ChannelReadState | null {
    return this.db.query<ChannelReadState, [string, number]>(
      "SELECT * FROM channel_read_state WHERE npub = ? AND channel_id = ?"
    ).get(npub, channelId) ?? null;
  }

  updateChannelReadState(npub: string, channelId: number, lastMessageId: number | null): ChannelReadState | null {
    return this.db.query<ChannelReadState, [string, number, number | null]>(
      `INSERT INTO channel_read_state (npub, channel_id, last_read_message_id, last_read_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(npub, channel_id) DO UPDATE SET
         last_read_message_id = excluded.last_read_message_id,
         last_read_at = CURRENT_TIMESTAMP
       RETURNING *`
    ).get(npub, channelId, lastMessageId) ?? null;
  }

  getUnreadCounts(npub: string): UnreadCount[] {
    return this.db.query<UnreadCount, [string, string, string, string, string]>(
      `SELECT
         m.channel_id,
         COUNT(CASE WHEN m.author != ? AND (crs.last_read_message_id IS NULL OR m.id > crs.last_read_message_id) THEN 1 END) as unread_count,
         COUNT(CASE WHEN m.author != ? AND mm.mentioned_npub = ? AND (crs.last_read_message_id IS NULL OR m.id > crs.last_read_message_id) THEN 1 END) as mention_count
       FROM messages m
       JOIN channels c ON m.channel_id = c.id
       LEFT JOIN channel_read_state crs ON m.channel_id = crs.channel_id AND crs.npub = ?
       LEFT JOIN message_mentions mm ON m.id = mm.message_id
       WHERE c.is_public = 1 OR c.owner_npub = ?
       GROUP BY m.channel_id
       HAVING unread_count > 0`
    ).all(npub, npub, npub, npub, npub);
  }

  // ============================================================================
  // Users
  // ============================================================================

  listUsers(): User[] {
    return this.db.query<User, []>("SELECT * FROM users ORDER BY updated_at DESC").all();
  }

  getUserByNpub(npub: string): User | null {
    return this.db.query<User, [string]>("SELECT * FROM users WHERE npub = ?").get(npub) ?? null;
  }

  getUserByPubkey(pubkey: string): User | null {
    return this.db.query<User, [string]>("SELECT * FROM users WHERE pubkey = ?").get(pubkey) ?? null;
  }

  upsertUser(user: {
    npub: string;
    pubkey: string;
    displayName?: string | null;
    name?: string | null;
    about?: string | null;
    picture?: string | null;
    nip05?: string | null;
    lastLogin?: string | null;
  }): User | null {
    return this.db.query<User, [string, string, string | null, string | null, string | null, string | null, string | null, string | null]>(
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
    ).get(
      user.npub,
      user.pubkey,
      user.displayName ?? null,
      user.name ?? null,
      user.about ?? null,
      user.picture ?? null,
      user.nip05 ?? null,
      user.lastLogin ?? null
    ) ?? null;
  }

  // ============================================================================
  // Groups
  // ============================================================================

  listGroups(): Group[] {
    return this.db.query<Group, []>("SELECT * FROM groups ORDER BY name").all();
  }

  getGroup(id: number): Group | null {
    return this.db.query<Group, [number]>("SELECT * FROM groups WHERE id = ?").get(id) ?? null;
  }

  getGroupByName(name: string): Group | null {
    return this.db.query<Group, [string]>("SELECT * FROM groups WHERE name = ?").get(name) ?? null;
  }

  createGroup(name: string, description: string, createdBy: string): Group | null {
    return this.db.query<Group, [string, string, string]>(
      "INSERT INTO groups (name, description, created_by) VALUES (?, ?, ?) RETURNING *"
    ).get(name, description, createdBy) ?? null;
  }

  updateGroup(id: number, name: string, description: string): Group | null {
    return this.db.query<Group, [string, string, number]>(
      "UPDATE groups SET name = ?, description = ? WHERE id = ? RETURNING *"
    ).get(name, description, id) ?? null;
  }

  deleteGroup(id: number): void {
    this.db.run("DELETE FROM groups WHERE id = ?", [id]);
  }

  listGroupMembers(groupId: number): GroupMember[] {
    return this.db.query<GroupMember, [number]>(
      "SELECT * FROM group_members WHERE group_id = ?"
    ).all(groupId);
  }

  addGroupMember(groupId: number, npub: string): void {
    this.db.run("INSERT OR IGNORE INTO group_members (group_id, npub) VALUES (?, ?)", [groupId, npub]);
  }

  removeGroupMember(groupId: number, npub: string): void {
    this.db.run("DELETE FROM group_members WHERE group_id = ? AND npub = ?", [groupId, npub]);
  }

  getGroupsForUser(npub: string): Group[] {
    return this.db.query<Group, [string]>(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.npub = ?
       ORDER BY g.name`
    ).all(npub);
  }

  // ============================================================================
  // Channel Groups
  // ============================================================================

  listChannelGroups(channelId: number): number[] {
    const rows = this.db.query<{ group_id: number }, [number]>(
      "SELECT group_id FROM channel_groups WHERE channel_id = ?"
    ).all(channelId);
    return rows.map(r => r.group_id);
  }

  addChannelGroup(channelId: number, groupId: number): void {
    this.db.run("INSERT OR IGNORE INTO channel_groups (channel_id, group_id) VALUES (?, ?)", [channelId, groupId]);
  }

  removeChannelGroup(channelId: number, groupId: number): void {
    this.db.run("DELETE FROM channel_groups WHERE channel_id = ? AND group_id = ?", [channelId, groupId]);
  }

  getChannelMembersWithoutKeys(channelId: number): string[] {
    const rows = this.db.query<{ npub: string }, [number, number]>(
      `SELECT DISTINCT gm.npub FROM group_members gm
       JOIN channel_groups cg ON gm.group_id = cg.group_id
       WHERE cg.channel_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM user_channel_keys uck
         JOIN users u ON uck.user_pubkey = u.pubkey
         WHERE uck.channel_id = ? AND u.npub = gm.npub
       )`
    ).all(channelId, channelId);
    return rows.map(r => r.npub);
  }

  getEncryptedChannelsForGroup(groupId: number): Channel[] {
    return this.db.query<Channel, [number]>(
      `SELECT c.* FROM channels c
       JOIN channel_groups cg ON c.id = cg.channel_id
       WHERE cg.group_id = ? AND c.encrypted = 1`
    ).all(groupId);
  }

  userHasChannelAccessViaGroups(channelId: number, npub: string): boolean {
    const result = this.db.query<{ has_access: number }, [number, string]>(
      `SELECT CASE WHEN EXISTS (
        SELECT 1 FROM channel_groups cg
        JOIN group_members gm ON cg.group_id = gm.group_id
        WHERE cg.channel_id = ? AND gm.npub = ?
      ) THEN 1 ELSE 0 END as has_access`
    ).get(channelId, npub);
    return result?.has_access === 1;
  }

  revokeUserChannelKeys(userPubkey: string, channelId: number): void {
    this.db.run("DELETE FROM user_channel_keys WHERE user_pubkey = ? AND channel_id = ?", [userPubkey, channelId]);
  }

  // ============================================================================
  // Push Notifications
  // ============================================================================

  getVapidConfig(): VapidConfig | null {
    return this.db.query<VapidConfig, []>("SELECT * FROM vapid_config WHERE id = 1").get() ?? null;
  }

  createVapidConfig(publicKey: string, privateKey: string, contactEmail: string): VapidConfig | null {
    return this.db.query<VapidConfig, [string, string, string]>(
      "INSERT INTO vapid_config (id, public_key, private_key, contact_email) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, private_key = excluded.private_key, contact_email = excluded.contact_email RETURNING *"
    ).get(publicKey, privateKey, contactEmail) ?? null;
  }

  getPushSubscriptionByEndpoint(endpoint: string): PushSubscription | null {
    return this.db.query<PushSubscription, [string]>(
      "SELECT * FROM push_subscriptions WHERE endpoint = ?"
    ).get(endpoint) ?? null;
  }

  getPushSubscriptionsForUser(npub: string): PushSubscription[] {
    return this.db.query<PushSubscription, [string]>(
      "SELECT * FROM push_subscriptions WHERE npub = ? AND is_active = 1"
    ).all(npub);
  }

  getActivePushSubscriptions(frequency?: NotificationFrequency): PushSubscription[] {
    if (frequency) {
      return this.db.query<PushSubscription, [string]>(
        "SELECT * FROM push_subscriptions WHERE is_active = 1 AND frequency = ?"
      ).all(frequency);
    }
    return this.db.query<PushSubscription, []>(
      "SELECT * FROM push_subscriptions WHERE is_active = 1"
    ).all();
  }

  upsertPushSubscription(npub: string, endpoint: string, p256dhKey: string, authKey: string, frequency: NotificationFrequency): PushSubscription | null {
    return this.db.query<PushSubscription, [string, string, string, string, string]>(
      `INSERT INTO push_subscriptions (npub, endpoint, p256dh_key, auth_key, frequency)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         npub = excluded.npub,
         p256dh_key = excluded.p256dh_key,
         auth_key = excluded.auth_key,
         frequency = excluded.frequency,
         is_active = 1
       RETURNING *`
    ).get(npub, endpoint, p256dhKey, authKey, frequency) ?? null;
  }

  updatePushSubscriptionFrequency(npub: string, endpoint: string, frequency: NotificationFrequency): void {
    this.db.run("UPDATE push_subscriptions SET frequency = ? WHERE npub = ? AND endpoint = ?", [frequency, npub, endpoint]);
  }

  deactivatePushSubscription(endpoint: string): void {
    this.db.run("UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?", [endpoint]);
  }

  markPushSubscriptionSent(id: number): void {
    this.db.run("UPDATE push_subscriptions SET last_sent_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  }

  // ============================================================================
  // Task-Thread Links
  // ============================================================================

  linkThreadToTask(todoId: number, messageId: number, linkedBy: string): TaskThread | null {
    return this.db.query<TaskThread, [number, number, string]>(
      "INSERT INTO task_threads (todo_id, message_id, linked_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING *"
    ).get(todoId, messageId, linkedBy) ?? null;
  }

  unlinkThreadFromTask(todoId: number, messageId: number): void {
    this.db.run("DELETE FROM task_threads WHERE todo_id = ? AND message_id = ?", [todoId, messageId]);
  }

  getThreadsForTask(todoId: number): TaskThread[] {
    return this.db.query<TaskThread, [number]>(
      "SELECT * FROM task_threads WHERE todo_id = ? ORDER BY linked_at DESC"
    ).all(todoId);
  }

  getTasksForThread(messageId: number): TaskThread[] {
    return this.db.query<TaskThread, [number]>(
      "SELECT * FROM task_threads WHERE message_id = ? ORDER BY linked_at DESC"
    ).all(messageId);
  }

  getThreadLinkCount(todoId: number): number {
    const result = this.db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM task_threads WHERE todo_id = ?"
    ).get(todoId);
    return result?.count ?? 0;
  }

  getTaskThreadLink(todoId: number, messageId: number): TaskThread | null {
    return this.db.query<TaskThread, [number, number]>(
      "SELECT * FROM task_threads WHERE todo_id = ? AND message_id = ?"
    ).get(todoId, messageId) ?? null;
  }

  // ============================================================================
  // App Settings
  // ============================================================================

  getSetting(key: string): string | null {
    const result = this.db.query<AppSetting, [string]>(
      "SELECT * FROM app_settings WHERE key = ?"
    ).get(key);
    return result?.value ?? null;
  }

  setSetting(key: string, value: string): AppSetting | null {
    return this.db.query<AppSetting, [string, string]>(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP RETURNING *"
    ).get(key, value) ?? null;
  }

  deleteSetting(key: string): void {
    this.db.run("DELETE FROM app_settings WHERE key = ?", [key]);
  }

  listSettings(): AppSetting[] {
    return this.db.query<AppSetting, []>("SELECT * FROM app_settings ORDER BY key").all();
  }

  listSettingsByPrefix(prefix: string): AppSetting[] {
    return this.db.query<AppSetting, [string]>(
      "SELECT * FROM app_settings WHERE key LIKE ? ORDER BY key"
    ).all(`${prefix}%`);
  }

  // ============================================================================
  // Wingman Costs
  // ============================================================================

  recordWingmanCost(npub: string, model: string, promptTokens: number, completionTokens: number, totalTokens: number, costUsd: number): WingmanCost | null {
    return this.db.query<WingmanCost, [string, string, number, number, number, number]>(
      "INSERT INTO wingman_costs (npub, model, prompt_tokens, completion_tokens, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
    ).get(npub, model, promptTokens, completionTokens, totalTokens, costUsd) ?? null;
  }

  listWingmanCosts(limit: number = 100): WingmanCost[] {
    return this.db.query<WingmanCost, [number]>(
      "SELECT * FROM wingman_costs ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
  }

  listWingmanCostsByNpub(npub: string, limit: number = 100): WingmanCost[] {
    return this.db.query<WingmanCost, [string, number]>(
      "SELECT * FROM wingman_costs WHERE npub = ? ORDER BY created_at DESC LIMIT ?"
    ).all(npub, limit);
  }

  getWingmanCostSummary(): { total_cost: number; total_tokens: number } {
    return this.db.query<{ total_cost: number; total_tokens: number }, []>(
      "SELECT COALESCE(SUM(cost_usd), 0) as total_cost, COALESCE(SUM(total_tokens), 0) as total_tokens FROM wingman_costs"
    ).get() ?? { total_cost: 0, total_tokens: 0 };
  }

  getWingmanTotalCost(): number {
    const result = this.db.query<{ total: number }, []>(
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM wingman_costs"
    ).get();
    return result?.total ?? 0;
  }

  // ============================================================================
  // Encryption Keys
  // ============================================================================

  getUserChannelKey(userPubkey: string, channelId: number): UserChannelKey | null {
    return this.db.query<UserChannelKey, [string, number]>(
      "SELECT * FROM user_channel_keys WHERE user_pubkey = ? AND channel_id = ? ORDER BY key_version DESC LIMIT 1"
    ).get(userPubkey, channelId) ?? null;
  }

  getUserChannelKeyByVersion(userPubkey: string, channelId: number, keyVersion: number): UserChannelKey | null {
    return this.db.query<UserChannelKey, [string, number, number]>(
      "SELECT * FROM user_channel_keys WHERE user_pubkey = ? AND channel_id = ? AND key_version = ?"
    ).get(userPubkey, channelId, keyVersion) ?? null;
  }

  getChannelKeys(channelId: number): UserChannelKey[] {
    return this.db.query<UserChannelKey, [number]>(
      "SELECT * FROM user_channel_keys WHERE channel_id = ?"
    ).all(channelId);
  }

  getLatestKeyVersion(channelId: number): number {
    const result = this.db.query<{ max_version: number | null }, [number]>(
      "SELECT MAX(key_version) as max_version FROM user_channel_keys WHERE channel_id = ?"
    ).get(channelId);
    return result?.max_version ?? 0;
  }

  storeUserChannelKey(userPubkey: string, channelId: number, encryptedKey: string, keyVersion: number): UserChannelKey | null {
    return this.db.query<UserChannelKey, [string, number, string, number]>(
      "INSERT INTO user_channel_keys (user_pubkey, channel_id, encrypted_key, key_version) VALUES (?, ?, ?, ?) ON CONFLICT(user_pubkey, channel_id, key_version) DO UPDATE SET encrypted_key = excluded.encrypted_key RETURNING *"
    ).get(userPubkey, channelId, encryptedKey, keyVersion) ?? null;
  }

  deleteUserChannelKeys(userPubkey: string, channelId: number): void {
    this.db.run("DELETE FROM user_channel_keys WHERE user_pubkey = ? AND channel_id = ?", [userPubkey, channelId]);
  }

  setChannelEncrypted(channelId: number): void {
    this.db.run("UPDATE channels SET encrypted = 1, encryption_enabled_at = CURRENT_TIMESTAMP WHERE id = ?", [channelId]);
  }

  // ============================================================================
  // Community Keys
  // ============================================================================

  getCommunityKey(userPubkey: string): CommunityKey | null {
    return this.db.query<CommunityKey, [string]>(
      "SELECT * FROM community_keys WHERE user_pubkey = ?"
    ).get(userPubkey) ?? null;
  }

  storeCommunityKey(userPubkey: string, encryptedKey: string): CommunityKey | null {
    return this.db.query<CommunityKey, [string, string]>(
      "INSERT INTO community_keys (user_pubkey, encrypted_key) VALUES (?, ?) ON CONFLICT(user_pubkey) DO UPDATE SET encrypted_key = excluded.encrypted_key RETURNING *"
    ).get(userPubkey, encryptedKey) ?? null;
  }

  listAllCommunityKeys(): CommunityKey[] {
    return this.db.query<CommunityKey, []>("SELECT * FROM community_keys").all();
  }

  countCommunityKeys(): number {
    const result = this.db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM community_keys"
    ).get();
    return result?.count ?? 0;
  }

  storeCommunityKeysBatch(keys: Array<{ userPubkey: string; encryptedKey: string }>): void {
    const stmt = this.db.prepare(
      "INSERT INTO community_keys (user_pubkey, encrypted_key) VALUES (?, ?) ON CONFLICT(user_pubkey) DO UPDATE SET encrypted_key = excluded.encrypted_key"
    );
    for (const key of keys) {
      stmt.run(key.userPubkey, key.encryptedKey);
    }
  }

  getCommunityState(key: string): string | null {
    const result = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM community_state WHERE key = ?"
    ).get(key);
    return result?.value ?? null;
  }

  setCommunityState(key: string, value: string): void {
    this.db.run(
      "INSERT INTO community_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
      [key, value]
    );
  }

  isCommunityBootstrapped(): boolean {
    return this.getCommunityState("bootstrapped") === "true";
  }

  isMessageMigrationComplete(): boolean {
    return this.getCommunityState("message_migration_complete") === "true";
  }

  // ============================================================================
  // Invite Codes
  // ============================================================================

  getInviteByHash(codeHash: string): InviteCode | null {
    return this.db.query<InviteCode, [string]>(
      "SELECT * FROM invite_codes WHERE code_hash = ?"
    ).get(codeHash) ?? null;
  }

  createInviteCode(codeHash: string, encryptedKey: string, singleUse: boolean, createdBy: string, expiresAt: number): InviteCode | null {
    return this.db.query<InviteCode, [string, string, number, string, number]>(
      "INSERT INTO invite_codes (code_hash, encrypted_key, single_use, created_by, expires_at) VALUES (?, ?, ?, ?, ?) RETURNING *"
    ).get(codeHash, encryptedKey, singleUse ? 1 : 0, createdBy, expiresAt) ?? null;
  }

  listActiveInvites(): InviteCode[] {
    const now = Math.floor(Date.now() / 1000);
    return this.db.query<InviteCode, [number]>(
      "SELECT * FROM invite_codes WHERE expires_at > ? ORDER BY created_at DESC"
    ).all(now);
  }

  listInvitesByCreator(npub: string): InviteCode[] {
    return this.db.query<InviteCode, [string]>(
      "SELECT * FROM invite_codes WHERE created_by = ? ORDER BY created_at DESC"
    ).all(npub);
  }

  deleteInviteCode(id: number): void {
    this.db.run("DELETE FROM invite_codes WHERE id = ?", [id]);
  }

  redeemInvite(inviteId: number, userNpub: string): boolean {
    const invite = this.db.query<InviteCode, [number]>(
      "SELECT * FROM invite_codes WHERE id = ?"
    ).get(inviteId);
    if (!invite) return false;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (invite.expires_at < now) return false;

    // Check single-use
    if (invite.single_use && invite.redeemed_count > 0) return false;

    // Record redemption
    this.db.run(
      "INSERT OR IGNORE INTO invite_redemptions (invite_id, user_npub) VALUES (?, ?)",
      [inviteId, userNpub]
    );
    this.db.run(
      "UPDATE invite_codes SET redeemed_count = redeemed_count + 1 WHERE id = ?",
      [inviteId]
    );

    return true;
  }

  hasUserRedeemedInvite(inviteId: number, userNpub: string): boolean {
    const result = this.db.query<{ count: number }, [number, string]>(
      "SELECT COUNT(*) as count FROM invite_redemptions WHERE invite_id = ? AND user_npub = ?"
    ).get(inviteId, userNpub);
    return (result?.count ?? 0) > 0;
  }

  // ============================================================================
  // User Onboarding
  // ============================================================================

  setUserOnboarded(npub: string): void {
    this.db.run("UPDATE users SET onboarded = 1, onboarded_at = unixepoch() WHERE npub = ?", [npub]);
  }

  isUserOnboarded(npub: string): boolean {
    const result = this.db.query<{ onboarded: number }, [string]>(
      "SELECT onboarded FROM users WHERE npub = ?"
    ).get(npub);
    return result?.onboarded === 1;
  }

  listOnboardedUsers(): User[] {
    return this.db.query<User, []>("SELECT * FROM users WHERE onboarded = 1").all();
  }

  listNonOnboardedUsers(): User[] {
    return this.db.query<User, []>("SELECT * FROM users WHERE onboarded = 0 OR onboarded IS NULL").all();
  }

  // ============================================================================
  // Message Migration
  // ============================================================================

  getUnencryptedPublicMessages(limit: number, afterId?: number): Message[] {
    if (afterId !== undefined) {
      return this.db.query<Message, [number, number]>(
        `SELECT m.* FROM messages m
         JOIN channels c ON m.channel_id = c.id
         WHERE c.is_public = 1 AND m.encrypted = 0 AND m.id > ?
         ORDER BY m.id ASC LIMIT ?`
      ).all(afterId, limit);
    }
    return this.db.query<Message, [number]>(
      `SELECT m.* FROM messages m
       JOIN channels c ON m.channel_id = c.id
       WHERE c.is_public = 1 AND m.encrypted = 0
       ORDER BY m.id ASC LIMIT ?`
    ).all(limit);
  }

  countUnencryptedPublicMessages(): number {
    const result = this.db.query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM messages m
       JOIN channels c ON m.channel_id = c.id
       WHERE c.is_public = 1 AND m.encrypted = 0`
    ).get();
    return result?.count ?? 0;
  }

  updateMessageToEncrypted(messageId: number, encryptedBody: string, keyVersion: number): void {
    this.db.run(
      "UPDATE messages SET body = ?, encrypted = 1, key_version = ? WHERE id = ?",
      [encryptedBody, keyVersion, messageId]
    );
  }

  updateMessagesToEncryptedBatch(messages: Array<{ id: number; body: string; keyVersion: number }>): void {
    const stmt = this.db.prepare(
      "UPDATE messages SET body = ?, encrypted = 1, key_version = ? WHERE id = ?"
    );
    for (const msg of messages) {
      stmt.run(msg.body, msg.keyVersion, msg.id);
    }
  }

  // ============================================================================
  // CRM - Companies
  // ============================================================================

  listCrmCompanies(): CrmCompany[] {
    return this.db.query<CrmCompany, []>(
      "SELECT * FROM crm_companies WHERE deleted = 0 ORDER BY name"
    ).all();
  }

  getCrmCompany(id: number): CrmCompany | null {
    return this.db.query<CrmCompany, [number]>(
      "SELECT * FROM crm_companies WHERE id = ? AND deleted = 0"
    ).get(id) ?? null;
  }

  createCrmCompany(name: string, createdBy: string, website?: string, industry?: string, notes?: string): CrmCompany | null {
    return this.db.query<CrmCompany, [string, string | null, string | null, string | null, string]>(
      "INSERT INTO crm_companies (name, website, industry, notes, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *"
    ).get(name, website ?? null, industry ?? null, notes ?? null, createdBy) ?? null;
  }

  updateCrmCompany(id: number, name: string, website?: string, industry?: string, notes?: string): CrmCompany | null {
    return this.db.query<CrmCompany, [string, string | null, string | null, string | null, number]>(
      "UPDATE crm_companies SET name = ?, website = ?, industry = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted = 0 RETURNING *"
    ).get(name, website ?? null, industry ?? null, notes ?? null, id) ?? null;
  }

  deleteCrmCompany(id: number): void {
    this.db.run("UPDATE crm_companies SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  }

  // ============================================================================
  // CRM - Contacts
  // ============================================================================

  listCrmContacts(): CrmContact[] {
    return this.db.query<CrmContact, []>(
      "SELECT * FROM crm_contacts WHERE deleted = 0 ORDER BY name"
    ).all();
  }

  listCrmContactsByCompany(companyId: number): CrmContact[] {
    return this.db.query<CrmContact, [number]>(
      "SELECT * FROM crm_contacts WHERE company_id = ? AND deleted = 0 ORDER BY name"
    ).all(companyId);
  }

  getCrmContact(id: number): CrmContact | null {
    return this.db.query<CrmContact, [number]>(
      "SELECT * FROM crm_contacts WHERE id = ? AND deleted = 0"
    ).get(id) ?? null;
  }

  createCrmContact(params: {
    name: string;
    createdBy: string;
    companyId?: number;
    email?: string;
    phone?: string;
    npub?: string;
    twitter?: string;
    linkedin?: string;
    notes?: string;
  }): CrmContact | null {
    const { name, createdBy, companyId, email, phone, npub, twitter, linkedin, notes } = params;
    return this.db.query<CrmContact, [string, number | null, string | null, string | null, string | null, string | null, string | null, string | null, string]>(
      "INSERT INTO crm_contacts (name, company_id, email, phone, npub, twitter, linkedin, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).get(name, companyId ?? null, email ?? null, phone ?? null, npub ?? null, twitter ?? null, linkedin ?? null, notes ?? null, createdBy) ?? null;
  }

  updateCrmContact(params: {
    id: number;
    name: string;
    companyId?: number;
    email?: string;
    phone?: string;
    npub?: string;
    twitter?: string;
    linkedin?: string;
    notes?: string;
  }): CrmContact | null {
    const { id, name, companyId, email, phone, npub, twitter, linkedin, notes } = params;
    return this.db.query<CrmContact, [string, number | null, string | null, string | null, string | null, string | null, string | null, string | null, number]>(
      "UPDATE crm_contacts SET name = ?, company_id = ?, email = ?, phone = ?, npub = ?, twitter = ?, linkedin = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted = 0 RETURNING *"
    ).get(name, companyId ?? null, email ?? null, phone ?? null, npub ?? null, twitter ?? null, linkedin ?? null, notes ?? null, id) ?? null;
  }

  deleteCrmContact(id: number): void {
    this.db.run("UPDATE crm_contacts SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  }

  // ============================================================================
  // CRM - Opportunities
  // ============================================================================

  listCrmOpportunities(): CrmOpportunity[] {
    return this.db.query<CrmOpportunity, []>(
      "SELECT * FROM crm_opportunities WHERE deleted = 0 ORDER BY created_at DESC"
    ).all();
  }

  listCrmOpportunitiesByStage(stage: CrmOpportunityStage): CrmOpportunity[] {
    return this.db.query<CrmOpportunity, [string]>(
      "SELECT * FROM crm_opportunities WHERE stage = ? AND deleted = 0 ORDER BY created_at DESC"
    ).all(stage);
  }

  getCrmOpportunity(id: number): CrmOpportunity | null {
    return this.db.query<CrmOpportunity, [number]>(
      "SELECT * FROM crm_opportunities WHERE id = ? AND deleted = 0"
    ).get(id) ?? null;
  }

  createCrmOpportunity(params: {
    title: string;
    createdBy: string;
    companyId?: number;
    contactId?: number;
    value?: number;
    currency?: string;
    stage?: CrmOpportunityStage;
    probability?: number;
    expectedClose?: string;
    notes?: string;
  }): CrmOpportunity | null {
    const { title, createdBy, companyId, contactId, value, currency = "USD", stage = "lead", probability = 0, expectedClose, notes } = params;
    return this.db.query<CrmOpportunity, [string, number | null, number | null, number | null, string, string, number, string | null, string | null, string]>(
      "INSERT INTO crm_opportunities (title, company_id, contact_id, value, currency, stage, probability, expected_close, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).get(title, companyId ?? null, contactId ?? null, value ?? null, currency, stage, probability, expectedClose ?? null, notes ?? null, createdBy) ?? null;
  }

  updateCrmOpportunity(params: {
    id: number;
    title: string;
    companyId?: number;
    contactId?: number;
    value?: number;
    currency?: string;
    stage?: CrmOpportunityStage;
    probability?: number;
    expectedClose?: string;
    notes?: string;
  }): CrmOpportunity | null {
    const { id, title, companyId, contactId, value, currency = "USD", stage = "lead", probability = 0, expectedClose, notes } = params;
    return this.db.query<CrmOpportunity, [string, number | null, number | null, number | null, string, string, number, string | null, string | null, number]>(
      "UPDATE crm_opportunities SET title = ?, company_id = ?, contact_id = ?, value = ?, currency = ?, stage = ?, probability = ?, expected_close = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted = 0 RETURNING *"
    ).get(title, companyId ?? null, contactId ?? null, value ?? null, currency, stage, probability, expectedClose ?? null, notes ?? null, id) ?? null;
  }

  deleteCrmOpportunity(id: number): void {
    this.db.run("UPDATE crm_opportunities SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  }

  // ============================================================================
  // CRM - Activities
  // ============================================================================

  listCrmActivities(): CrmActivity[] {
    return this.db.query<CrmActivity, []>(
      "SELECT * FROM crm_activities WHERE deleted = 0 ORDER BY activity_date DESC"
    ).all();
  }

  listCrmActivitiesByContact(contactId: number): CrmActivity[] {
    return this.db.query<CrmActivity, [number]>(
      "SELECT * FROM crm_activities WHERE contact_id = ? AND deleted = 0 ORDER BY activity_date DESC"
    ).all(contactId);
  }

  listCrmActivitiesByOpportunity(opportunityId: number): CrmActivity[] {
    return this.db.query<CrmActivity, [number]>(
      "SELECT * FROM crm_activities WHERE opportunity_id = ? AND deleted = 0 ORDER BY activity_date DESC"
    ).all(opportunityId);
  }

  listCrmActivitiesByCompany(companyId: number): CrmActivity[] {
    return this.db.query<CrmActivity, [number]>(
      "SELECT * FROM crm_activities WHERE company_id = ? AND deleted = 0 ORDER BY activity_date DESC"
    ).all(companyId);
  }

  getCrmActivity(id: number): CrmActivity | null {
    return this.db.query<CrmActivity, [number]>(
      "SELECT * FROM crm_activities WHERE id = ? AND deleted = 0"
    ).get(id) ?? null;
  }

  createCrmActivity(params: {
    type: string;
    subject: string;
    activityDate: string;
    createdBy: string;
    contactId?: number;
    opportunityId?: number;
    companyId?: number;
    description?: string;
  }): CrmActivity | null {
    const { type, subject, activityDate, createdBy, contactId, opportunityId, companyId, description } = params;
    return this.db.query<CrmActivity, [number | null, number | null, number | null, string, string, string | null, string, string]>(
      "INSERT INTO crm_activities (contact_id, opportunity_id, company_id, type, subject, description, activity_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).get(contactId ?? null, opportunityId ?? null, companyId ?? null, type, subject, description ?? null, activityDate, createdBy) ?? null;
  }

  deleteCrmActivity(id: number): void {
    this.db.run("UPDATE crm_activities SET deleted = 1 WHERE id = ?", [id]);
  }

  getCrmPipelineSummary(): Array<{ stage: string; count: number; total_value: number }> {
    return this.db.query<{ stage: string; count: number; total_value: number }, []>(
      `SELECT stage, COUNT(*) as count, COALESCE(SUM(value), 0) as total_value
       FROM crm_opportunities WHERE deleted = 0
       GROUP BY stage ORDER BY
       CASE stage
         WHEN 'lead' THEN 1
         WHEN 'qualified' THEN 2
         WHEN 'proposal' THEN 3
         WHEN 'negotiation' THEN 4
         WHEN 'closed_won' THEN 5
         WHEN 'closed_lost' THEN 6
       END`
    ).all();
  }

  getOutstandingCrmTasks(): Array<Todo & {
    link_id: number;
    contact_id: number | null;
    company_id: number | null;
    activity_id: number | null;
    opportunity_id: number | null;
    contact_name: string | null;
    company_name: string | null;
    opportunity_title: string | null;
  }> {
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
    return this.db.query<CrmLinkedTask, []>(
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
    ).all();
  }

  // ============================================================================
  // Wallet Transactions
  // ============================================================================

  saveWalletTransaction(params: {
    npub: string;
    type: "incoming" | "outgoing";
    amountMsats: number;
    invoice?: string;
    paymentHash?: string;
    state?: "pending" | "settled" | "failed";
    description?: string;
  }): WalletTransaction | null {
    const { npub, type, amountMsats, invoice, paymentHash, state = "pending", description } = params;
    return this.db.query<WalletTransaction, [string, string, number, string | null, string | null, string, string | null]>(
      "INSERT INTO wallet_transactions (npub, type, amount_msats, invoice, payment_hash, state, description) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).get(npub, type, amountMsats, invoice ?? null, paymentHash ?? null, state, description ?? null) ?? null;
  }

  listWalletTransactions(npub: string, limit: number = 50): WalletTransaction[] {
    return this.db.query<WalletTransaction, [string, number]>(
      "SELECT * FROM wallet_transactions WHERE npub = ? ORDER BY created_at DESC LIMIT ?"
    ).all(npub, limit);
  }

  getWalletTransactionByHash(npub: string, paymentHash: string): WalletTransaction | null {
    return this.db.query<WalletTransaction, [string, string]>(
      "SELECT * FROM wallet_transactions WHERE npub = ? AND payment_hash = ?"
    ).get(npub, paymentHash) ?? null;
  }

  updateWalletTransactionState(id: number, state: "pending" | "settled" | "failed"): void {
    const settledAt = state === "settled" ? "CURRENT_TIMESTAMP" : "NULL";
    this.db.run(`UPDATE wallet_transactions SET state = ?, settled_at = ${settledAt} WHERE id = ?`, [state, id]);
  }

  // ============================================================================
  // Team Encryption (Zero-Knowledge Key Distribution)
  // ============================================================================

  /**
   * Get team encryption configuration
   * Returns null if team encryption hasn't been initialized yet
   */
  getTeamEncryption(): TeamEncryption | null {
    return this.db.query<TeamEncryption, []>(
      "SELECT * FROM team_encryption WHERE id = 1"
    ).get() ?? null;
  }

  /**
   * Initialize team encryption with the first team pubkey
   * This is called when the first invite is created
   */
  initTeamEncryption(teamPubkey: string, initializedBy: string): TeamEncryption | null {
    return this.db.query<TeamEncryption, [string, string]>(
      "INSERT INTO team_encryption (id, team_pubkey, initialized_by) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING *"
    ).get(teamPubkey, initializedBy) ?? null;
  }

  /**
   * Check if team encryption has been initialized
   */
  isTeamEncryptionInitialized(): boolean {
    return this.getTeamEncryption() !== null;
  }

  /**
   * Get a user's encrypted team key
   */
  getUserTeamKey(userPubkey: string): UserTeamKey | null {
    return this.db.query<UserTeamKey, [string]>(
      "SELECT * FROM user_team_keys WHERE user_pubkey = ?"
    ).get(userPubkey) ?? null;
  }

  /**
   * Store a user's encrypted team key
   * This is called when a user first joins the team and their key is wrapped
   */
  storeUserTeamKey(userPubkey: string, encryptedTeamKey: string, wrappedBy: string): UserTeamKey | null {
    return this.db.query<UserTeamKey, [string, string, string]>(
      `INSERT INTO user_team_keys (user_pubkey, encrypted_team_key, wrapped_by)
       VALUES (?, ?, ?)
       ON CONFLICT(user_pubkey) DO UPDATE SET
         encrypted_team_key = excluded.encrypted_team_key,
         wrapped_by = excluded.wrapped_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`
    ).get(userPubkey, encryptedTeamKey, wrappedBy) ?? null;
  }

  /**
   * Delete a user's team key (when removed from team)
   */
  deleteUserTeamKey(userPubkey: string): void {
    this.db.run("DELETE FROM user_team_keys WHERE user_pubkey = ?", [userPubkey]);
  }

  /**
   * List all users who have team keys
   */
  listUsersWithTeamKeys(): UserTeamKey[] {
    return this.db.query<UserTeamKey, []>(
      "SELECT * FROM user_team_keys ORDER BY created_at"
    ).all();
  }

  /**
   * Count users with team keys
   */
  countUsersWithTeamKeys(): number {
    const result = this.db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM user_team_keys"
    ).get();
    return result?.count ?? 0;
  }

  /**
   * Check if a user has a team key
   */
  hasUserTeamKey(userPubkey: string): boolean {
    return this.getUserTeamKey(userPubkey) !== null;
  }

  // ============================================================================
  // Key Requests
  // ============================================================================

  /**
   * Create a key request for a user who needs encryption keys
   */
  createKeyRequest(params: {
    channelId: number;
    requesterNpub: string;
    requesterPubkey: string;
    targetNpub: string;
    inviteCodeHash?: string;
    groupId?: number;
  }): KeyRequest | null {
    try {
      this.db.run(
        `INSERT OR IGNORE INTO key_requests
         (channel_id, requester_npub, requester_pubkey, target_npub, invite_code_hash, group_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          params.channelId,
          params.requesterNpub,
          params.requesterPubkey,
          params.targetNpub,
          params.inviteCodeHash || null,
          params.groupId || null,
        ]
      );
      return this.db.query<KeyRequest, [number, string]>(
        "SELECT * FROM key_requests WHERE channel_id = ? AND requester_npub = ?"
      ).get(params.channelId, params.requesterNpub) ?? null;
    } catch (err) {
      console.error("[TeamDB] Error creating key request:", err);
      return null;
    }
  }

  /**
   * Get a key request by ID
   */
  getKeyRequest(id: number): KeyRequest | null {
    return this.db.query<KeyRequest, [number]>(
      "SELECT * FROM key_requests WHERE id = ?"
    ).get(id) ?? null;
  }

  /**
   * List pending key requests for a target (manager) to fulfill
   */
  listPendingKeyRequests(targetNpub: string): KeyRequest[] {
    return this.db.query<KeyRequest, [string]>(
      `SELECT * FROM key_requests
       WHERE target_npub = ? AND status = 'pending'
       ORDER BY created_at ASC`
    ).all(targetNpub);
  }

  /**
   * List key requests made by a user
   */
  listKeyRequestsByRequester(requesterNpub: string): KeyRequest[] {
    return this.db.query<KeyRequest, [string]>(
      `SELECT * FROM key_requests
       WHERE requester_npub = ?
       ORDER BY created_at DESC`
    ).all(requesterNpub);
  }

  /**
   * List pending key requests for a specific channel
   */
  listPendingKeyRequestsForChannel(channelId: number): KeyRequest[] {
    return this.db.query<KeyRequest, [number]>(
      `SELECT * FROM key_requests
       WHERE channel_id = ? AND status = 'pending'
       ORDER BY created_at ASC`
    ).all(channelId);
  }

  /**
   * Mark a key request as fulfilled
   */
  fulfillKeyRequest(id: number, fulfilledBy: string): boolean {
    const result = this.db.run(
      `UPDATE key_requests
       SET status = 'fulfilled', fulfilled_by = ?, fulfilled_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [fulfilledBy, id]
    );
    return result.changes > 0;
  }

  /**
   * Mark a key request as rejected
   */
  rejectKeyRequest(id: number): boolean {
    const result = this.db.run(
      `UPDATE key_requests
       SET status = 'rejected'
       WHERE id = ? AND status = 'pending'`,
      [id]
    );
    return result.changes > 0;
  }

  /**
   * Delete key requests for a user (when removing from team)
   */
  deleteKeyRequestsForUser(npub: string): number {
    const result = this.db.run(
      "DELETE FROM key_requests WHERE requester_npub = ?",
      [npub]
    );
    return result.changes;
  }
}
