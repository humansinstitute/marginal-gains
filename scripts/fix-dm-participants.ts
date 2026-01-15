#!/usr/bin/env bun
/**
 * Fix DM Participants Migration Script
 *
 * After migrating to multitenancy, the dm_participants table may be empty
 * even though DM channels exist. This script populates dm_participants
 * by looking at message authors in each DM channel.
 *
 * Usage: bun scripts/fix-dm-participants.ts [database-path]
 * Example: bun scripts/fix-dm-participants.ts data/teams/marginal-grains.sqlite
 */

import { Database } from "bun:sqlite";

interface Channel {
  id: number;
  name: string;
  display_name: string;
}

interface MessageAuthor {
  author: string;
}

function fixDmParticipants(dbPath: string): void {
  console.log(`Opening database: ${dbPath}`);
  const db = new Database(dbPath);

  // Get all DM channels
  const dmChannels = db.query<Channel, []>(
    "SELECT id, name, display_name FROM channels WHERE name LIKE 'dm-%'"
  ).all();

  console.log(`Found ${dmChannels.length} DM channels`);

  if (dmChannels.length === 0) {
    console.log("No DM channels found, nothing to fix.");
    db.close();
    return;
  }

  // Check current dm_participants count
  const currentCount = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM dm_participants"
  ).get()?.count ?? 0;

  console.log(`Current dm_participants entries: ${currentCount}`);

  let skipped = 0;

  for (const channel of dmChannels) {
    // Get distinct message authors for this channel
    const authors = db.query<MessageAuthor, [number]>(
      "SELECT DISTINCT author FROM messages WHERE channel_id = ?"
    ).all(channel.id);

    if (authors.length === 0) {
      console.log(`  Channel ${channel.id} (${channel.name}): no messages, skipping`);
      skipped++;
      continue;
    }

    console.log(`  Channel ${channel.id} (${channel.name}): found ${authors.length} participants`);

    for (const { author } of authors) {
      try {
        db.run(
          "INSERT OR IGNORE INTO dm_participants (channel_id, npub) VALUES (?, ?)",
          [channel.id, author]
        );
      } catch (error) {
        console.error(`    Failed to insert participant ${author}: ${error}`);
      }
    }
  }

  // Get final count
  const finalCount = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM dm_participants"
  ).get()?.count ?? 0;

  console.log(`\nSummary:`);
  console.log(`  DM channels processed: ${dmChannels.length}`);
  console.log(`  Channels skipped (no messages): ${skipped}`);
  console.log(`  Participant entries added: ${finalCount - currentCount}`);
  console.log(`  Total dm_participants entries: ${finalCount}`);

  db.close();
  console.log("\nDone!");
}

// Main
const dbPath = process.argv[2];

if (!dbPath) {
  console.error("Usage: bun scripts/fix-dm-participants.ts <database-path>");
  console.error("Example: bun scripts/fix-dm-participants.ts data/teams/marginal-grains.sqlite");
  process.exit(1);
}

// Check if file exists
const file = Bun.file(dbPath);
if (!await file.exists()) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

fixDmParticipants(dbPath);
