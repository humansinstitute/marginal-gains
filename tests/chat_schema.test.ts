import { rm } from "fs/promises";
import { join } from "path";

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const TEST_DB_PATH = join(import.meta.dir, "tmp-chat-schema.sqlite");
await rm(TEST_DB_PATH, { force: true });
Bun.env.DB_PATH = TEST_DB_PATH;
process.env.DB_PATH = TEST_DB_PATH;

// Trigger DB bootstrap on an isolated module instance so other tests' imports don't share state.
await import("../src/db?module=chat");

describe("chat schema", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(TEST_DB_PATH);
    db.run("PRAGMA foreign_keys = ON");
  });

  afterAll(async () => {
    db?.close();
    await rm(TEST_DB_PATH, { force: true });
  });

  test("supports channels, threaded messages, mentions, and quoting", () => {
    const channelColumns = db.query("PRAGMA table_info(channels)").all() as { name: string }[];
    expect(channelColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "name", "display_name", "description", "creator", "is_public", "created_at"])
    );

    const messageColumns = db.query("PRAGMA table_info(messages)").all() as { name: string }[];
    expect(messageColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "id",
        "channel_id",
        "author",
        "body",
        "thread_root_id",
        "parent_id",
        "quoted_message_id",
        "created_at",
        "edited_at",
      ])
    );

    const messageFks = db.query("PRAGMA foreign_key_list(messages)").all() as { table: string }[];
    expect(messageFks.map((fk) => fk.table)).toEqual(expect.arrayContaining(["channels", "messages"]));

    const channel = db
      .query(
        `INSERT INTO channels (name, display_name, description, creator, is_public)
         VALUES (?, ?, ?, ?, 1)
         RETURNING id`
      )
      .get("general", "General", "Default channel", "npub1alice") as { id: number };

    const root = db
      .query(
        `INSERT INTO messages (channel_id, author, body, thread_root_id, parent_id, quoted_message_id)
         VALUES (?, ?, ?, NULL, NULL, NULL)
         RETURNING id`
      )
      .get(channel.id, "npub1alice", "Hello, team!") as { id: number };

    const reply = db
      .query(
        `INSERT INTO messages (channel_id, author, body, thread_root_id, parent_id, quoted_message_id)
         VALUES (?, ?, ?, ?, ?, NULL)
         RETURNING id`
      )
      .get(channel.id, "npub1bob", "Replying in thread", root.id, root.id) as { id: number };

    const quoted = db
      .query(
        `INSERT INTO messages (channel_id, author, body, thread_root_id, parent_id, quoted_message_id)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`
      )
      .get(channel.id, "npub1carol", "Quoting the root while replying", root.id, reply.id, root.id) as {
        id: number;
      };

    db.query("INSERT INTO message_mentions (message_id, mentioned_npub) VALUES (?, ?)").run(quoted.id, "npub1bob");

    const thread = db
      .query(
        "SELECT id, parent_id, thread_root_id FROM messages WHERE thread_root_id = ? OR id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(root.id, root.id) as { id: number; parent_id: number | null; thread_root_id: number | null }[];

    const rootRow = thread.find((row) => row.parent_id === null);
    expect(rootRow).toBeDefined();
    expect(rootRow!.id).toBe(root.id);

    const replyRow = thread.find((row) => row.id === reply.id);
    expect(replyRow?.parent_id).toBe(root.id);
    expect(replyRow?.thread_root_id).toBe(root.id);

    const mentions = db
      .query("SELECT message_id, mentioned_npub FROM message_mentions WHERE mentioned_npub = ?")
      .all("npub1bob") as { message_id: number; mentioned_npub: string }[];

    expect(mentions.length).toBe(1);
    expect(mentions[0].message_id).toBe(quoted.id);
  });
});
